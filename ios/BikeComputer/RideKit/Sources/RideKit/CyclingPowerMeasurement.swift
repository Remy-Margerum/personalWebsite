import Foundation

/// Bluetooth SIG UUIDs used by the power meter (Favero Assioma exposes the
/// standard Cycling Power Service, with crank revolution data for cadence).
public enum BluetoothUUIDs {
    public static let cyclingPowerService = "1818"
    public static let cyclingPowerMeasurement = "2A63"
    public static let cyclingPowerFeature = "2A65"
    public static let batteryService = "180F"
    public static let batteryLevel = "2A19"
}

/// A decoded Cycling Power Measurement (characteristic 0x2A63).
///
/// Layout (all little-endian): flags `UInt16`, instantaneous power `Int16`,
/// then optional fields in flag order. Only the fields up to and including
/// crank revolution data are decoded; later fields (extreme forces, dead
/// spot angles, accumulated energy) are not needed here.
public struct CyclingPowerMeasurement: Equatable, Sendable {
    public struct Flags: OptionSet, Sendable {
        public let rawValue: UInt16
        public init(rawValue: UInt16) { self.rawValue = rawValue }

        public static let pedalPowerBalancePresent = Flags(rawValue: 1 << 0)
        public static let pedalPowerBalanceReferenceLeft = Flags(rawValue: 1 << 1)
        public static let accumulatedTorquePresent = Flags(rawValue: 1 << 2)
        public static let wheelRevolutionDataPresent = Flags(rawValue: 1 << 4)
        public static let crankRevolutionDataPresent = Flags(rawValue: 1 << 5)
    }

    public struct CrankData: Equatable, Sendable {
        /// Cumulative crank revolutions; wraps at 65 535.
        public let cumulativeRevolutions: UInt16
        /// Time of the last crank event in 1/1024 s; wraps every 64 s.
        public let lastEventTime: UInt16
    }

    public let flags: Flags
    public let instantaneousPower: Int
    /// Percentage of total power from the reference pedal (0.5 % resolution).
    public let pedalPowerBalance: Double?
    public let crank: CrankData?

    /// Returns nil when the packet is too short for the fields its flags declare.
    public init?(data: [UInt8]) {
        var reader = ByteReader(data)
        guard let rawFlags = reader.uint16(), let power = reader.int16() else { return nil }
        let flags = Flags(rawValue: rawFlags)
        self.flags = flags
        self.instantaneousPower = Int(power)

        if flags.contains(.pedalPowerBalancePresent) {
            guard let raw = reader.uint8() else { return nil }
            pedalPowerBalance = Double(raw) / 2
        } else {
            pedalPowerBalance = nil
        }
        if flags.contains(.accumulatedTorquePresent) {
            guard reader.skip(2) else { return nil }
        }
        if flags.contains(.wheelRevolutionDataPresent) {
            guard reader.skip(4 + 2) else { return nil }
        }
        if flags.contains(.crankRevolutionDataPresent) {
            guard let revs = reader.uint16(), let time = reader.uint16() else { return nil }
            crank = CrankData(cumulativeRevolutions: revs, lastEventTime: time)
        } else {
            crank = nil
        }
    }

    public init?(data: Data) { self.init(data: [UInt8](data)) }
}

/// Parses the single-byte Battery Level characteristic (0x2A19).
public func parseBatteryLevel(_ data: [UInt8]) -> Int? {
    guard let level = data.first, level <= 100 else { return nil }
    return Int(level)
}

struct ByteReader {
    private let bytes: [UInt8]
    private var offset = 0

    init(_ bytes: [UInt8]) { self.bytes = bytes }

    mutating func uint8() -> UInt8? {
        guard offset + 1 <= bytes.count else { return nil }
        defer { offset += 1 }
        return bytes[offset]
    }

    mutating func uint16() -> UInt16? {
        guard offset + 2 <= bytes.count else { return nil }
        defer { offset += 2 }
        return UInt16(bytes[offset]) | UInt16(bytes[offset + 1]) << 8
    }

    mutating func int16() -> Int16? {
        uint16().map { Int16(bitPattern: $0) }
    }

    mutating func skip(_ count: Int) -> Bool {
        guard offset + count <= bytes.count else { return false }
        offset += count
        return true
    }
}
