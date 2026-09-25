import Foundation
import RideKit

/// Uploads a ride's TCX to Intervals.icu, the same place the Cadence app
/// sends rides today, so remymargerum.com/cycling picks it up on its next
/// hourly sync with no other changes.
///
/// API: POST /api/v1/athlete/0/activities (multipart "file"), HTTP Basic
/// auth with username "API_KEY" and your personal key as the password
/// (Intervals.icu → Settings → Developer Settings).
enum IntervalsUploader {
    enum UploadError: LocalizedError {
        case missingKey
        case http(Int, String)

        var errorDescription: String? {
            switch self {
            case .missingKey: "Add your Intervals.icu API key in Settings first."
            case let .http(code, body): "Intervals.icu returned \(code): \(body.prefix(200))"
            }
        }
    }

    static func upload(tcxFile: URL, name: String) async throws {
        guard let apiKey = Keychain.read(Keychain.intervalsAPIKey), !apiKey.isEmpty else {
            throw UploadError.missingKey
        }
        var components = URLComponents(string: "https://intervals.icu/api/v1/athlete/0/activities")!
        components.queryItems = [URLQueryItem(name: "name", value: name)]

        let boundary = "Boundary-\(UUID().uuidString)"
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        let credentials = Data("API_KEY:\(apiKey)".utf8).base64EncodedString()
        request.setValue("Basic \(credentials)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(tcxFile.lastPathComponent)\"\r\n".utf8))
        body.append(Data("Content-Type: application/vnd.garmin.tcx+xml\r\n\r\n".utf8))
        body.append(try Data(contentsOf: tcxFile))
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw UploadError.http(status, String(decoding: data, as: UTF8.self))
        }
    }
}
