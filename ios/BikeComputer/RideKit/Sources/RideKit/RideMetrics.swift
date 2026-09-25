import Foundation

/// A GPS fix, independent of CoreLocation so the maths can be tested anywhere.
public struct LocationFix: Equatable, Sendable {
    public var timestamp: Date
    public var latitude: Double
    public var longitude: Double
    /// Metres; negative means invalid (CoreLocation convention).
    public var horizontalAccuracy: Double
    /// m/s; negative means invalid.
    public var speed: Double

    public init(timestamp: Date, latitude: Double, longitude: Double, horizontalAccuracy: Double, speed: Double) {
        self.timestamp = timestamp
        self.latitude = latitude
        self.longitude = longitude
        self.horizontalAccuracy = horizontalAccuracy
        self.speed = speed
    }
}

/// Great-circle distance in metres.
public func haversineDistance(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
    let earthRadius = 6_371_008.8
    let dLat = (lat2 - lat1) * .pi / 180
    let dLon = (lon2 - lon1) * .pi / 180
    let a = sin(dLat / 2) * sin(dLat / 2)
        + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
    return 2 * earthRadius * atan2(sqrt(a), sqrt(1 - a))
}

/// Sums GPS distance while dropping fixes that would inflate it: poor
/// accuracy, stationary jitter and teleport-style jumps.
public struct DistanceAccumulator: Sendable {
    public var maxHorizontalAccuracy: Double
    public var maxPlausibleSpeed: Double

    public private(set) var total: Double = 0
    private var last: LocationFix?

    public init(maxHorizontalAccuracy: Double = 20, maxPlausibleSpeed: Double = 30) {
        self.maxHorizontalAccuracy = maxHorizontalAccuracy
        self.maxPlausibleSpeed = maxPlausibleSpeed
    }

    /// Returns true if the fix was accepted.
    @discardableResult
    public mutating func add(_ fix: LocationFix) -> Bool {
        guard fix.horizontalAccuracy >= 0, fix.horizontalAccuracy <= maxHorizontalAccuracy else { return false }
        guard let previous = last else {
            last = fix
            return true
        }
        let dt = fix.timestamp.timeIntervalSince(previous.timestamp)
        guard dt > 0 else { return false }
        let d = haversineDistance(lat1: previous.latitude, lon1: previous.longitude,
                                  lat2: fix.latitude, lon2: fix.longitude)
        if d / dt > maxPlausibleSpeed { return false }
        // Standing still: GPS wanders a few metres. Only count movement the
        // receiver itself reports, or movement larger than the fix's error.
        let moving = fix.speed >= 0.5 || (fix.speed < 0 && d > fix.horizontalAccuracy)
        if moving { total += d }
        last = fix
        return true
    }

    /// After a pause, the next fix starts a new segment instead of adding the
    /// straight line from where you stopped.
    public mutating func breakSegment() { last = nil }
}

/// Elevation gain with hysteresis, so sensor noise isn't counted as climbing.
/// Use ~1 m with the barometer and ~4 m with GPS altitude.
public struct ElevationGainAccumulator: Sendable {
    public var threshold: Double
    public private(set) var gain: Double = 0
    public private(set) var loss: Double = 0
    private var reference: Double?

    public init(threshold: Double = 1) { self.threshold = threshold }

    public mutating func add(altitude: Double) {
        guard let ref = reference else {
            reference = altitude
            return
        }
        let delta = altitude - ref
        if delta >= threshold {
            gain += delta
            reference = altitude
        } else if -delta >= threshold {
            loss += -delta
            reference = altitude
        }
    }
}

/// Rolling average over a fixed time window, used for 3 s power on the dashboard.
public struct RollingAverage: Sendable {
    public var window: TimeInterval
    private var values: [(Date, Double)] = []

    public init(window: TimeInterval) { self.window = window }

    public mutating func add(_ value: Double, at date: Date) {
        values.append((date, value))
        values.removeAll { date.timeIntervalSince($0.0) > window }
    }

    public var average: Double? {
        values.isEmpty ? nil : values.map(\.1).reduce(0, +) / Double(values.count)
    }
}
