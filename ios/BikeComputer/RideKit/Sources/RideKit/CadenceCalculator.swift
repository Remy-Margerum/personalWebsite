import Foundation

/// Turns successive crank revolution readings into cadence (rpm).
///
/// The power meter only sends a running count of crank revolutions and the
/// time of the last one (1/1024 s ticks). Both counters wrap, so deltas use
/// wrapping subtraction. Readings arrive more often than the crank turns;
/// a reading with no new revolution keeps the previous cadence until
/// `stopTimeout` passes without one, then cadence drops to zero (coasting).
public struct CadenceCalculator: Sendable {
    public var stopTimeout: TimeInterval
    public var maxPlausibleRPM: Double

    public private(set) var cadence: Double?
    private var last: CyclingPowerMeasurement.CrankData?
    private var lastRevolutionAt: Date?

    public init(stopTimeout: TimeInterval = 3, maxPlausibleRPM: Double = 250) {
        self.stopTimeout = stopTimeout
        self.maxPlausibleRPM = maxPlausibleRPM
    }

    /// Feeds one reading received at `receivedAt` and returns the current cadence.
    @discardableResult
    public mutating func update(_ crank: CyclingPowerMeasurement.CrankData, receivedAt: Date) -> Double? {
        defer { last = crank }
        guard let previous = last else {
            lastRevolutionAt = receivedAt
            return cadence
        }

        let revs = crank.cumulativeRevolutions &- previous.cumulativeRevolutions
        let ticks = crank.lastEventTime &- previous.lastEventTime

        if revs == 0 || ticks == 0 {
            if let lastRev = lastRevolutionAt, receivedAt.timeIntervalSince(lastRev) >= stopTimeout {
                cadence = 0
            }
            return cadence
        }

        let rpm = Double(revs) * 60 * 1024 / Double(ticks)
        if rpm <= maxPlausibleRPM {
            cadence = rpm
        }
        lastRevolutionAt = receivedAt
        return cadence
    }

    /// Call periodically (e.g. from the 1 Hz sampler) so cadence falls to zero
    /// even if the sensor stops sending while you coast.
    public mutating func expireIfStale(now: Date) {
        if let lastRev = lastRevolutionAt, now.timeIntervalSince(lastRev) >= stopTimeout, cadence != nil {
            cadence = 0
        }
    }

    public mutating func reset() {
        self = CadenceCalculator(stopTimeout: stopTimeout, maxPlausibleRPM: maxPlausibleRPM)
    }
}
