import Foundation

/// Display formatting. Imperial by default; Settings has a metric toggle.
struct Units {
    var metric: Bool

    func speed(_ metresPerSecond: Double?) -> String {
        guard let v = metresPerSecond else { return "--" }
        return String(format: "%.1f", metric ? v * 3.6 : v * 2.236936)
    }
    var speedUnit: String { metric ? "km/h" : "mph" }

    func distance(_ metres: Double) -> String {
        String(format: "%.2f", metric ? metres / 1000 : metres / 1609.344)
    }
    var distanceUnit: String { metric ? "km" : "mi" }

    func elevation(_ metres: Double?) -> String {
        guard let v = metres else { return "--" }
        return String(format: "%.0f", metric ? v : v * 3.28084)
    }
    var elevationUnit: String { metric ? "m" : "ft" }

    static func duration(_ seconds: TimeInterval) -> String {
        let s = Int(seconds)
        return String(format: "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60)
    }

    static func whole(_ value: Double?) -> String {
        value.map { String(Int($0.rounded())) } ?? "--"
    }
}
