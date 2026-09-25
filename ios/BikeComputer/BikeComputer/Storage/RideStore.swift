import Foundation
import Observation
import RideKit

/// Saves each ride as JSON (full 1 Hz data) plus a TCX export in
/// Documents/Rides. The folder is visible in the Files app because
/// UIFileSharingEnabled / LSSupportsOpeningDocumentsInPlace are on.
@Observable
final class RideStore {
    private(set) var rides: [Ride] = []

    private let folder: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("Rides", isDirectory: true)
    }()

    init() {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        load()
    }

    func load() {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        rides = files
            .filter { $0.pathExtension == "json" }
            .compactMap { try? decoder.decode(Ride.self, from: Data(contentsOf: $0)) }
            .sorted { $0.startDate > $1.startDate }
    }

    func save(_ ride: Ride) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(ride).write(to: jsonURL(for: ride), options: .atomic)
        try Data(TCXWriter.tcx(for: ride).utf8).write(to: tcxURL(for: ride), options: .atomic)
        rides.removeAll { $0.id == ride.id }
        rides.insert(ride, at: 0)
    }

    func delete(_ ride: Ride) {
        try? FileManager.default.removeItem(at: jsonURL(for: ride))
        try? FileManager.default.removeItem(at: tcxURL(for: ride))
        rides.removeAll { $0.id == ride.id }
    }

    func tcxURL(for ride: Ride) -> URL {
        folder.appendingPathComponent("\(baseName(ride)).tcx")
    }

    private func jsonURL(for ride: Ride) -> URL {
        folder.appendingPathComponent("\(baseName(ride)).json")
    }

    private func baseName(_ ride: Ride) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd-HHmm"
        return "ride-\(formatter.string(from: ride.startDate))-\(ride.id.uuidString.prefix(8))"
    }
}
