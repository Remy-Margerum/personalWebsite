import SwiftUI

@main
struct BikeComputerApp: App {
    @State private var recorder = RideRecorder(
        power: PowerMeterService(),
        workout: WorkoutSessionService(),
        location: LocationService(),
        store: RideStore())
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(recorder)
        }
        .onChange(of: scenePhase) { _, phase in
            // GPS runs in the background only while a ride is in progress.
            if phase == .background && recorder.state == .idle {
                recorder.location.stop()
            } else if phase == .active {
                recorder.location.start()
            }
        }
    }
}

struct ContentView: View {
    var body: some View {
        TabView {
            Tab("Ride", systemImage: "bicycle") { RideView() }
            Tab("History", systemImage: "list.bullet") { HistoryView() }
            Tab("Settings", systemImage: "gear") { SettingsView() }
        }
    }
}
