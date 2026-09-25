import SwiftUI
import UIKit

/// The handlebar screen: big numbers, sensor status and ride controls.
struct RideView: View {
    @Environment(RideRecorder.self) private var recorder
    @AppStorage("useMetric") private var useMetric = false
    @State private var showSensors = false
    @State private var confirmFinish = false

    private var units: Units { Units(metric: useMetric) }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                SensorStatusBar()
                    .onTapGesture { showSensors = true }

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    MetricTile(title: "Power 3s", value: Units.whole(recorder.power.power3s), unit: "W", large: true)
                    MetricTile(title: "Heart rate", value: recorder.workout.heartRate.map(String.init) ?? "--", unit: "bpm", large: true)
                    MetricTile(title: "Speed", value: units.speed(recorder.speed), unit: units.speedUnit)
                    MetricTile(title: "Cadence", value: Units.whole(recorder.power.cadence), unit: "rpm")
                    MetricTile(title: "Distance", value: units.distance(recorder.distance), unit: units.distanceUnit)
                    MetricTile(title: "Time", value: Units.duration(recorder.movingTime), unit: "")
                    MetricTile(title: "Climbed", value: units.elevation(recorder.elevationGain), unit: units.elevationUnit)
                    MetricTile(title: "Altitude", value: units.elevation(recorder.location.altitude), unit: units.elevationUnit)
                }

                if let error = recorder.lastError ?? recorder.workout.lastError {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }

                Spacer()
                controls
            }
            .padding()
            .navigationTitle("Ride")
            .toolbar {
                Button("Sensors", systemImage: "sensor") { showSensors = true }
            }
            .sheet(isPresented: $showSensors) { SensorsView() }
            .confirmationDialog("Finish ride?", isPresented: $confirmFinish) {
                Button("Save ride") { Task { await recorder.finish() } }
                Button("Discard ride", role: .destructive) { recorder.discard() }
            }
        }
        .task {
            recorder.location.requestAuthorization()
            recorder.location.start()
            await recorder.workout.requestAuthorization()
        }
        .onChange(of: recorder.state) { _, state in
            // Keep the screen on while riding (phone on the handlebars).
            UIApplication.shared.isIdleTimerDisabled = state == .recording || state == .paused
        }
    }

    @ViewBuilder private var controls: some View {
        switch recorder.state {
        case .idle:
            Button { Task { await recorder.start() } } label: {
                Label("Start", systemImage: "play.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent).tint(.green).controlSize(.extraLarge)
        case .recording, .paused:
            HStack {
                Button {
                    recorder.state == .recording ? recorder.pause() : recorder.resume()
                } label: {
                    Label(recorder.state == .recording ? "Pause" : "Resume",
                          systemImage: recorder.state == .recording ? "pause.fill" : "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).tint(.orange)
                Button { confirmFinish = true } label: {
                    Label("Finish", systemImage: "stop.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).tint(.red)
            }
            .controlSize(.extraLarge)
        case .saving:
            ProgressView("Saving…")
        }
    }
}

struct MetricTile: View {
    let title: String
    let value: String
    let unit: String
    var large = false

    var body: some View {
        VStack(spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: large ? 56 : 40, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .minimumScaleFactor(0.5)
                .lineLimit(1)
            Text(unit).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: large ? 110 : 90)
        .background(.quaternary, in: .rect(cornerRadius: 12))
    }
}

struct SensorStatusBar: View {
    @Environment(RideRecorder.self) private var recorder

    var body: some View {
        HStack(spacing: 16) {
            status("bolt.fill", powerText, recorder.power.state == .connected)
            status("heart.fill", recorder.workout.heartRate == nil ? "No HR" : "HR", recorder.workout.heartRate != nil)
            status("location.fill", gpsText, (recorder.location.latestLocation?.horizontalAccuracy ?? 999) <= 20)
        }
        .font(.footnote)
        .frame(maxWidth: .infinity)
    }

    private var powerText: String {
        switch recorder.power.state {
        case .connected: recorder.power.batteryLevel.map { "Power \($0)%" } ?? "Power"
        case .connecting: "Waking pedals…"
        case .scanning: "Scanning…"
        case .idle, .poweredOff: "No power"
        }
    }

    private var gpsText: String {
        guard let accuracy = recorder.location.latestLocation?.horizontalAccuracy else { return "No GPS" }
        return "GPS ±\(Int(accuracy)) m"
    }

    private func status(_ icon: String, _ text: String, _ ok: Bool) -> some View {
        Label(text, systemImage: icon).foregroundStyle(ok ? .green : .secondary)
    }
}
