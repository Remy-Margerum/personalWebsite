import Foundation

/// One row of the 1 Hz ride recording. Nil means "no reading", which is
/// different from zero (e.g. power meter disconnected vs. coasting).
public struct RideSample: Codable, Equatable, Sendable {
    public var timestamp: Date
    public var latitude: Double?
    public var longitude: Double?
    /// Metres above sea level.
    public var altitude: Double?
    /// Cumulative ride distance in metres.
    public var distance: Double
    /// m/s
    public var speed: Double?
    public var heartRate: Int?
    public var power: Int?
    public var cadence: Int?

    public init(timestamp: Date, latitude: Double? = nil, longitude: Double? = nil, altitude: Double? = nil,
                distance: Double, speed: Double? = nil, heartRate: Int? = nil, power: Int? = nil, cadence: Int? = nil) {
        self.timestamp = timestamp
        self.latitude = latitude
        self.longitude = longitude
        self.altitude = altitude
        self.distance = distance
        self.speed = speed
        self.heartRate = heartRate
        self.power = power
        self.cadence = cadence
    }
}

public struct Ride: Codable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var startDate: Date
    public var endDate: Date
    /// Seconds spent recording (excludes manual pauses).
    public var movingTime: TimeInterval
    public var elevationGain: Double
    public var samples: [RideSample]

    public init(id: UUID = UUID(), startDate: Date, endDate: Date, movingTime: TimeInterval,
                elevationGain: Double, samples: [RideSample]) {
        self.id = id
        self.startDate = startDate
        self.endDate = endDate
        self.movingTime = movingTime
        self.elevationGain = elevationGain
        self.samples = samples
    }

    public var summary: RideSummary { RideSummary(ride: self) }
}

public struct RideSummary: Equatable, Sendable {
    public var distance: Double
    public var movingTime: TimeInterval
    public var elevationGain: Double
    public var averageSpeed: Double?
    public var maxSpeed: Double?
    public var averagePower: Double?
    public var normalizedPower: Double?
    public var maxPower: Int?
    public var averageHeartRate: Double?
    public var maxHeartRate: Int?
    /// Average of pedalling samples only (zeros from coasting excluded).
    public var averageCadence: Double?

    public init(ride: Ride) {
        let s = ride.samples
        distance = s.last?.distance ?? 0
        movingTime = ride.movingTime
        elevationGain = ride.elevationGain
        averageSpeed = movingTime > 0 ? distance / movingTime : nil
        maxSpeed = s.compactMap(\.speed).max()

        let powers = s.compactMap(\.power)
        averagePower = mean(powers.map(Double.init))
        maxPower = powers.max()
        normalizedPower = Self.normalizedPower(powers)

        let hrs = s.compactMap(\.heartRate)
        averageHeartRate = mean(hrs.map(Double.init))
        maxHeartRate = hrs.max()

        averageCadence = mean(s.compactMap(\.cadence).filter { $0 > 0 }.map(Double.init))
    }

    /// Normalized Power: 4th root of the mean of the 4th power of the 30 s
    /// rolling average. Expects 1 Hz samples; needs at least 30 of them.
    public static func normalizedPower(_ watts: [Int]) -> Double? {
        let window = 30
        guard watts.count >= window else { return nil }
        var sum = watts[0..<window].reduce(0, +)
        var fourth: [Double] = [pow(Double(sum) / Double(window), 4)]
        for i in window..<watts.count {
            sum += watts[i] - watts[i - window]
            fourth.append(pow(Double(sum) / Double(window), 4))
        }
        return pow(fourth.reduce(0, +) / Double(fourth.count), 0.25)
    }
}

private func mean(_ values: [Double]) -> Double? {
    values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)
}

/// A fixed-length slice of a ride, used to write power, cadence and distance
/// to HealthKit as a few thousand samples instead of one per second.
public struct RideBucket: Equatable, Sendable {
    public var start: Date
    public var end: Date
    public var averagePower: Double?
    /// Average of pedalling samples only.
    public var averageCadence: Double?
    /// Distance covered within this bucket, in metres.
    public var distance: Double
}

extension Ride {
    public func buckets(seconds: TimeInterval) -> [RideBucket] {
        guard seconds > 0, let first = samples.first else { return [] }
        var groups: [Int: [RideSample]] = [:]
        for sample in samples {
            groups[Int(sample.timestamp.timeIntervalSince(first.timestamp) / seconds), default: []].append(sample)
        }
        var previousDistance = first.distance
        return groups.keys.sorted().map { key in
            let group = groups[key]!
            let start = group.first!.timestamp
            // Each bucket ends where the next sample would begin, so spans don't overlap.
            let end = max(group.last!.timestamp.addingTimeInterval(1), start.addingTimeInterval(1))
            let powers = group.compactMap(\.power).map(Double.init)
            let cadences = group.compactMap(\.cadence).filter { $0 > 0 }.map(Double.init)
            let lastDistance = group.last!.distance
            defer { previousDistance = lastDistance }
            return RideBucket(
                start: start, end: end,
                averagePower: powers.isEmpty ? nil : powers.reduce(0, +) / Double(powers.count),
                averageCadence: cadences.isEmpty ? nil : cadences.reduce(0, +) / Double(cadences.count),
                distance: max(0, lastDistance - previousDistance))
        }
    }
}
