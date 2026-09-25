import SwiftUI

/// Pair the power meter and check the heart-rate source.
struct SensorsView: View {
    @Environment(RideRecorder.self) private var recorder
    @Environment(\.dismiss) private var dismiss

    private var power: PowerMeterService { recorder.power }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let name = power.connectedName, power.state == .connected {
                        LabeledContent(name) {
                            Text(power.batteryLevel.map { "Battery \($0)%" } ?? "Connected")
                        }
                        if let balance = power.balance {
                            LabeledContent("L/R balance", value: String(format: "%.0f / %.0f", balance, 100 - balance))
                        }
                        Button("Forget power meter", role: .destructive) { power.forget() }
                    } else if power.state == .connecting {
                        Label("Waiting for pedals — spin the cranks to wake them", systemImage: "hourglass")
                    } else {
                        ForEach(power.discovered) { device in
                            Button {
                                power.connect(to: device.id)
                            } label: {
                                LabeledContent(device.name, value: "\(device.rssi) dBm")
                            }
                        }
                        Button(power.state == .scanning ? "Scanning…" : "Scan for power meters") {
                            power.startScan()
                        }
                        .disabled(power.state == .scanning || power.state == .poweredOff)
                    }
                } header: {
                    Text("Power & cadence")
                } footer: {
                    Text("Favero Assioma: spin the cranks to wake the pedals before scanning. If a head unit is also connected to them over Bluetooth, pair that one over ANT+ instead so the pedals have a free Bluetooth connection for the phone.")
                }

                Section {
                    LabeledContent("Heart rate", value: recorder.workout.heartRate.map { "\($0) bpm" } ?? "Not receiving")
                } header: {
                    Text("Heart rate")
                } footer: {
                    Text("Comes from AirPods Pro 3 through Apple Health while a ride is recording. At least one AirPod must be in — in California (CVC 27400) you may not wear earbuds in both ears while cycling. A Bluetooth HR strap paired in iOS Settings also works.")
                }
            }
            .navigationTitle("Sensors")
            .toolbar { Button("Done") { dismiss() } }
            .onDisappear { power.stopScan() }
        }
    }
}
