import XCTest
#if canImport(FoundationXML)
import FoundationXML // XMLParser lives here on Linux
#endif
@testable import RideKit

final class CyclingPowerMeasurementTests: XCTestCase {
    func testPowerOnly() throws {
        let m = try XCTUnwrap(CyclingPowerMeasurement(data: [0x00, 0x00, 0xFA, 0x00]))
        XCTAssertEqual(m.instantaneousPower, 250)
        XCTAssertNil(m.crank)
        XCTAssertNil(m.pedalPowerBalance)
    }

    func testBalanceAndCrankData() throws {
        // flags 0x0023: balance present, reference left, crank data present
        // power 300 W, balance 0x64 = 50.0 %, revs 0x0102, time 0x0400 (1 s)
        let bytes: [UInt8] = [0x23, 0x00, 0x2C, 0x01, 0x64, 0x02, 0x01, 0x00, 0x04]
        let m = try XCTUnwrap(CyclingPowerMeasurement(data: bytes))
        XCTAssertEqual(m.instantaneousPower, 300)
        XCTAssertEqual(m.pedalPowerBalance, 50.0)
        XCTAssertTrue(m.flags.contains(.pedalPowerBalanceReferenceLeft))
        XCTAssertEqual(m.crank, .init(cumulativeRevolutions: 0x0102, lastEventTime: 0x0400))
    }

    func testCrankDataAfterTorqueAndWheelFields() throws {
        // flags 0x0034: accumulated torque + wheel data + crank data
        let bytes: [UInt8] = [0x34, 0x00, 0x64, 0x00,
                              0xAA, 0xBB,                         // torque (skipped)
                              0x01, 0x02, 0x03, 0x04, 0x05, 0x06, // wheel (skipped)
                              0x0A, 0x00, 0x00, 0x08]             // crank
        let m = try XCTUnwrap(CyclingPowerMeasurement(data: bytes))
        XCTAssertEqual(m.instantaneousPower, 100)
        XCTAssertEqual(m.crank, .init(cumulativeRevolutions: 10, lastEventTime: 0x0800))
    }

    func testNegativePowerIsSigned() throws {
        let m = try XCTUnwrap(CyclingPowerMeasurement(data: [0x00, 0x00, 0xFF, 0xFF]))
        XCTAssertEqual(m.instantaneousPower, -1)
    }

    func testTruncatedPacketIsRejected() {
        XCTAssertNil(CyclingPowerMeasurement(data: [0x00]))
        XCTAssertNil(CyclingPowerMeasurement(data: [0x20, 0x00, 0x64, 0x00, 0x01]))
    }

    func testBatteryLevel() {
        XCTAssertEqual(parseBatteryLevel([87]), 87)
        XCTAssertNil(parseBatteryLevel([]))
        XCTAssertNil(parseBatteryLevel([200]))
    }
}

final class CadenceCalculatorTests: XCTestCase {
    let t0 = Date(timeIntervalSince1970: 1_000_000)

    func testNinetyRPM() {
        var calc = CadenceCalculator()
        calc.update(.init(cumulativeRevolutions: 100, lastEventTime: 0), receivedAt: t0)
        // 3 revolutions in 2 s (2048 ticks) = 90 rpm
        let rpm = calc.update(.init(cumulativeRevolutions: 103, lastEventTime: 2048), receivedAt: t0 + 2)
        XCTAssertEqual(try XCTUnwrap(rpm), 90, accuracy: 0.001)
    }

    func testCounterRollover() {
        var calc = CadenceCalculator()
        calc.update(.init(cumulativeRevolutions: 65_535, lastEventTime: 65_000), receivedAt: t0)
        // 1 revolution, 683 ticks across the time wrap ≈ 89.96 rpm
        let rpm = calc.update(.init(cumulativeRevolutions: 0, lastEventTime: 147), receivedAt: t0 + 1)
        XCTAssertEqual(try XCTUnwrap(rpm), 60 * 1024 / 683, accuracy: 0.01)
    }

    func testRepeatedReadingKeepsCadenceThenDropsToZero() {
        var calc = CadenceCalculator(stopTimeout: 3)
        calc.update(.init(cumulativeRevolutions: 1, lastEventTime: 0), receivedAt: t0)
        calc.update(.init(cumulativeRevolutions: 2, lastEventTime: 1024), receivedAt: t0 + 1)
        XCTAssertEqual(calc.update(.init(cumulativeRevolutions: 2, lastEventTime: 1024), receivedAt: t0 + 2), 60)
        XCTAssertEqual(calc.update(.init(cumulativeRevolutions: 2, lastEventTime: 1024), receivedAt: t0 + 4.5), 0)
    }

    func testExpireIfStale() {
        var calc = CadenceCalculator(stopTimeout: 3)
        calc.update(.init(cumulativeRevolutions: 1, lastEventTime: 0), receivedAt: t0)
        calc.update(.init(cumulativeRevolutions: 2, lastEventTime: 1024), receivedAt: t0 + 1)
        calc.expireIfStale(now: t0 + 2)
        XCTAssertEqual(calc.cadence, 60)
        calc.expireIfStale(now: t0 + 5)
        XCTAssertEqual(calc.cadence, 0)
    }

    func testImplausibleValueIgnored() {
        var calc = CadenceCalculator()
        calc.update(.init(cumulativeRevolutions: 1, lastEventTime: 0), receivedAt: t0)
        calc.update(.init(cumulativeRevolutions: 2, lastEventTime: 1024), receivedAt: t0 + 1)
        calc.update(.init(cumulativeRevolutions: 50, lastEventTime: 2048), receivedAt: t0 + 2)
        XCTAssertEqual(calc.cadence, 60)
    }
}

final class RideMetricsTests: XCTestCase {
    let t0 = Date(timeIntervalSince1970: 1_000_000)

    func testHaversineOneDegreeOfLatitude() {
        XCTAssertEqual(haversineDistance(lat1: 0, lon1: 0, lat2: 1, lon2: 0), 111_195, accuracy: 10)
    }

    func testDistanceAccumulatorFiltersBadFixes() {
        var acc = DistanceAccumulator()
        // ~0.0001° latitude ≈ 11.1 m per step
        acc.add(LocationFix(timestamp: t0, latitude: 34.4, longitude: -119.7, horizontalAccuracy: 5, speed: 10))
        acc.add(LocationFix(timestamp: t0 + 1, latitude: 34.4001, longitude: -119.7, horizontalAccuracy: 5, speed: 10))
        XCTAssertEqual(acc.total, 11.1, accuracy: 0.1)

        // Poor accuracy: rejected
        XCTAssertFalse(acc.add(LocationFix(timestamp: t0 + 2, latitude: 34.5, longitude: -119.7, horizontalAccuracy: 65, speed: 10)))
        // Teleport (~1 km in 1 s): rejected
        XCTAssertFalse(acc.add(LocationFix(timestamp: t0 + 3, latitude: 34.41, longitude: -119.7, horizontalAccuracy: 5, speed: 10)))
        // Stationary jitter: accepted but not counted
        acc.add(LocationFix(timestamp: t0 + 4, latitude: 34.40012, longitude: -119.7, horizontalAccuracy: 5, speed: 0))
        XCTAssertEqual(acc.total, 11.1, accuracy: 0.1)
    }

    func testBreakSegmentSkipsGap() {
        var acc = DistanceAccumulator()
        acc.add(LocationFix(timestamp: t0, latitude: 34.4, longitude: -119.7, horizontalAccuracy: 5, speed: 5))
        acc.breakSegment()
        acc.add(LocationFix(timestamp: t0 + 600, latitude: 34.45, longitude: -119.7, horizontalAccuracy: 5, speed: 5))
        XCTAssertEqual(acc.total, 0)
    }

    func testElevationHysteresis() {
        var elev = ElevationGainAccumulator(threshold: 1)
        for alt in [100.0, 100.4, 99.8, 100.3, 101.2, 102.5, 102.1, 104.0, 103.0] {
            elev.add(altitude: alt)
        }
        // Counted: 100 → 101.2 → 102.5 → 104.0; the 0.4 m wobbles are ignored.
        XCTAssertEqual(elev.gain, 4.0, accuracy: 0.001)
        XCTAssertEqual(elev.loss, 1.0, accuracy: 0.001)
    }

    func testRollingAverage() {
        var avg = RollingAverage(window: 3)
        avg.add(100, at: t0)
        avg.add(200, at: t0 + 1)
        avg.add(300, at: t0 + 2)
        avg.add(400, at: t0 + 4)
        XCTAssertEqual(avg.average, 300) // 100 W (4 s old) has dropped out
    }
}

final class RideSummaryAndTCXTests: XCTestCase {
    let t0 = Date(timeIntervalSince1970: 1_758_800_000)

    func makeRide() -> Ride {
        let samples = (0..<60).map { (i: Int) -> RideSample in
            let x = Double(i)
            let power: Int = i < 30 ? 100 : 300
            let cadence: Int = i == 0 ? 0 : 90
            return RideSample(timestamp: t0.addingTimeInterval(x), latitude: 34.4 + x * 0.0001, longitude: -119.7,
                              altitude: 10 + x * 0.1, distance: x * 11.1, speed: 11.1,
                              heartRate: 140 + i % 10, power: power, cadence: cadence)
        }
        return Ride(startDate: t0, endDate: t0 + 59, movingTime: 59, elevationGain: 5.9, samples: samples)
    }

    func testSummary() throws {
        let s = makeRide().summary
        XCTAssertEqual(s.distance, 59 * 11.1, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(s.averagePower), 200, accuracy: 0.001)
        XCTAssertEqual(s.maxPower, 300)
        XCTAssertEqual(s.maxHeartRate, 149)
        XCTAssertEqual(try XCTUnwrap(s.averageCadence), 90, accuracy: 0.001) // leading zero excluded
        // NP of a 100 W → 300 W step is above the 200 W average
        XCTAssertGreaterThan(try XCTUnwrap(s.normalizedPower), 200)
    }

    func testNormalizedPowerOfSteadyEffortEqualsAverage() throws {
        XCTAssertEqual(try XCTUnwrap(RideSummary.normalizedPower(Array(repeating: 250, count: 120))), 250, accuracy: 0.001)
        XCTAssertNil(RideSummary.normalizedPower([250, 250]))
    }

    func testBuckets() throws {
        let ride = makeRide()
        let buckets = ride.buckets(seconds: 5)
        XCTAssertEqual(buckets.count, 12)
        XCTAssertEqual(buckets[0].start, t0)
        XCTAssertEqual(buckets[0].end, t0 + 5)
        XCTAssertEqual(try XCTUnwrap(buckets[0].averagePower), 100, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(buckets[0].averageCadence), 90, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(buckets[11].averagePower), 300, accuracy: 0.001)
        // Bucket distances add back up to the ride's total.
        XCTAssertEqual(buckets.map(\.distance).reduce(0, +), ride.summary.distance, accuracy: 0.001)
    }

    func testTCXContainsAllChannelsAndParses() throws {
        let xml = TCXWriter.tcx(for: makeRide())
        XCTAssertTrue(xml.contains(#"<Activity Sport="Biking">"#))
        XCTAssertTrue(xml.contains("<Id>2025-09-25T11:33:20Z</Id>"))
        XCTAssertTrue(xml.contains("<LatitudeDegrees>34.4000000</LatitudeDegrees>"))
        XCTAssertTrue(xml.contains("<HeartRateBpm><Value>140</Value></HeartRateBpm>"))
        XCTAssertTrue(xml.contains("<Cadence>90</Cadence>"))
        XCTAssertTrue(xml.contains("<ns3:Watts>300</ns3:Watts>"))
        XCTAssertEqual(xml.components(separatedBy: "<Trackpoint>").count - 1, 60)

        let parser = XMLParser(data: Data(xml.utf8))
        XCTAssertTrue(parser.parse(), "TCX is not well-formed XML: \(String(describing: parser.parserError))")
    }
}
