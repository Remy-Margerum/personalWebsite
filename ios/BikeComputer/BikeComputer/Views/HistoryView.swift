import RideKit
import SwiftUI

struct HistoryView: View {
    @Environment(RideRecorder.self) private var recorder
    @AppStorage("useMetric") private var useMetric = false

    var body: some View {
        NavigationStack {
            List {
                ForEach(recorder.store.rides) { ride in
                    NavigationLink(value: ride.id) {
                        VStack(alignment: .leading) {
                            Text(ride.startDate, format: .dateTime.weekday().month().day().hour().minute())
                            let units = Units(metric: useMetric)
                            Text("\(units.distance(ride.summary.distance)) \(units.distanceUnit) · \(Units.duration(ride.movingTime))")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                .onDelete { offsets in
                    offsets.map { recorder.store.rides[$0] }.forEach(recorder.store.delete)
                }
            }
            .overlay {
                if recorder.store.rides.isEmpty {
                    ContentUnavailableView("No rides yet", systemImage: "bicycle")
                }
            }
            .navigationTitle("History")
            .navigationDestination(for: UUID.self) { id in
                if let ride = recorder.store.rides.first(where: { $0.id == id }) {
                    RideDetailView(ride: ride)
                }
            }
        }
    }
}

struct RideDetailView: View {
    let ride: Ride
    @Environment(RideRecorder.self) private var recorder
    @AppStorage("useMetric") private var useMetric = false
    @State private var uploadStatus: String?
    @State private var uploading = false

    var body: some View {
        let s = ride.summary
        let units = Units(metric: useMetric)
        List {
            Section("Summary") {
                LabeledContent("Distance", value: "\(units.distance(s.distance)) \(units.distanceUnit)")
                LabeledContent("Moving time", value: Units.duration(s.movingTime))
                LabeledContent("Climbed", value: "\(units.elevation(s.elevationGain)) \(units.elevationUnit)")
                LabeledContent("Avg speed", value: "\(units.speed(s.averageSpeed)) \(units.speedUnit)")
                LabeledContent("Max speed", value: "\(units.speed(s.maxSpeed)) \(units.speedUnit)")
            }
            Section("Power & heart rate") {
                LabeledContent("Avg power", value: "\(Units.whole(s.averagePower)) W")
                LabeledContent("Normalized power", value: "\(Units.whole(s.normalizedPower)) W")
                LabeledContent("Max power", value: "\(s.maxPower.map(String.init) ?? "--") W")
                LabeledContent("Avg cadence", value: "\(Units.whole(s.averageCadence)) rpm")
                LabeledContent("Avg heart rate", value: "\(Units.whole(s.averageHeartRate)) bpm")
                LabeledContent("Max heart rate", value: "\(s.maxHeartRate.map(String.init) ?? "--") bpm")
            }
            Section {
                ShareLink(item: recorder.store.tcxURL(for: ride)) {
                    Label("Export TCX", systemImage: "square.and.arrow.up")
                }
                Button {
                    Task { await upload() }
                } label: {
                    Label(uploading ? "Uploading…" : "Upload to Intervals.icu", systemImage: "icloud.and.arrow.up")
                }
                .disabled(uploading)
                if let uploadStatus { Text(uploadStatus).font(.footnote) }
            }
        }
        .navigationTitle(ride.startDate.formatted(date: .abbreviated, time: .shortened))
    }

    private func upload() async {
        uploading = true
        defer { uploading = false }
        do {
            try await IntervalsUploader.upload(tcxFile: recorder.store.tcxURL(for: ride), name: "BikeComputer ride")
            uploadStatus = "Uploaded. It will show on the cycling page after the next hourly sync."
        } catch {
            uploadStatus = error.localizedDescription
        }
    }
}
