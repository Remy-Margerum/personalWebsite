import CoreBluetooth
import Foundation
import Observation
import RideKit

/// Connects to a Bluetooth Cycling Power meter (Favero Assioma) and publishes
/// power, cadence (from crank revolution data), L/R balance and battery.
///
/// Assioma pedals only advertise while awake: spin the cranks before scanning.
/// The chosen meter is remembered and reconnected automatically, including
/// after it drops out mid-ride (CoreBluetooth connect requests never time out).
@Observable
final class PowerMeterService: NSObject {
    enum ConnectionState: Equatable { case poweredOff, idle, scanning, connecting, connected }

    struct Discovered: Identifiable, Equatable {
        let id: UUID
        let name: String
        let rssi: Int
    }

    private(set) var state: ConnectionState = .poweredOff
    private(set) var discovered: [Discovered] = []
    private(set) var connectedName: String?

    private(set) var power: Int?
    private(set) var cadence: Double?
    /// Percentage from the reference pedal (left on Assioma Duo).
    private(set) var balance: Double?
    private(set) var batteryLevel: Int?
    private(set) var lastMeasurementAt: Date?

    /// 3-second average power, the usual dashboard number.
    var power3s: Double? { powerAverage.average }

    @ObservationIgnored private var central: CBCentralManager!
    @ObservationIgnored private var peripheral: CBPeripheral?
    @ObservationIgnored private var seen: [UUID: CBPeripheral] = [:]
    @ObservationIgnored private var cadenceCalculator = CadenceCalculator()
    private var powerAverage = RollingAverage(window: 3)

    private static let savedPeripheralKey = "PowerMeterService.peripheralID"
    private let powerService = CBUUID(string: BluetoothUUIDs.cyclingPowerService)
    private let powerMeasurement = CBUUID(string: BluetoothUUIDs.cyclingPowerMeasurement)
    private let batteryService = CBUUID(string: BluetoothUUIDs.batteryService)
    private let batteryLevelChar = CBUUID(string: BluetoothUUIDs.batteryLevel)

    override init() {
        super.init()
        // Main queue: delegate callbacks update UI-observed state directly.
        central = CBCentralManager(delegate: self, queue: nil)
    }

    var savedPeripheralID: UUID? {
        UserDefaults.standard.string(forKey: Self.savedPeripheralKey).flatMap(UUID.init(uuidString:))
    }

    func startScan() {
        guard central.state == .poweredOn else { return }
        discovered = []
        state = .scanning
        central.scanForPeripherals(withServices: [powerService])
    }

    func stopScan() {
        central.stopScan()
        if state == .scanning { state = .idle }
    }

    func connect(to id: UUID) {
        guard let target = seen[id] ?? central.retrievePeripherals(withIdentifiers: [id]).first else { return }
        central.stopScan()
        UserDefaults.standard.set(id.uuidString, forKey: Self.savedPeripheralKey)
        peripheral = target
        target.delegate = self
        state = .connecting
        central.connect(target)
    }

    func forget() {
        if let peripheral { central.cancelPeripheralConnection(peripheral) }
        peripheral = nil
        UserDefaults.standard.removeObject(forKey: Self.savedPeripheralKey)
        connectedName = nil
        state = .idle
        clearReadings()
    }

    /// Called by the recorder once a second: readings older than a few
    /// seconds mean the pedals stopped sending (coasting or dropout).
    func expireStaleReadings(now: Date) {
        cadenceCalculator.expireIfStale(now: now)
        cadence = cadenceCalculator.cadence
        if let last = lastMeasurementAt, now.timeIntervalSince(last) > 3 {
            power = state == .connected ? 0 : nil
            if state == .connected { powerAverage.add(0, at: now) }
        }
    }

    private func clearReadings() {
        power = nil
        cadence = nil
        balance = nil
        batteryLevel = nil
        lastMeasurementAt = nil
        cadenceCalculator.reset()
        powerAverage = RollingAverage(window: 3)
    }

    private func handle(_ measurement: CyclingPowerMeasurement, at date: Date) {
        lastMeasurementAt = date
        power = max(0, measurement.instantaneousPower)
        powerAverage.add(Double(power ?? 0), at: date)
        balance = measurement.pedalPowerBalance
        if let crank = measurement.crank {
            cadence = cadenceCalculator.update(crank, receivedAt: date)
        }
    }
}

extension PowerMeterService: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central.state == .poweredOn else {
            state = .poweredOff
            return
        }
        state = .idle
        if let id = savedPeripheralID { connect(to: id) }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = peripheral.name
            ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String
            ?? "Power meter"
        seen[peripheral.identifier] = peripheral
        let entry = Discovered(id: peripheral.identifier, name: name, rssi: RSSI.intValue)
        if let index = discovered.firstIndex(where: { $0.id == entry.id }) {
            discovered[index] = entry
        } else {
            discovered.append(entry)
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        state = .connected
        connectedName = peripheral.name
        peripheral.discoverServices([powerService, batteryService])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        state = .connecting
        central.connect(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        clearReadings()
        // Keep a pending connection open so the meter reattaches when it
        // wakes or comes back into range, unless the user chose "Forget".
        guard savedPeripheralID == peripheral.identifier else { return }
        state = .connecting
        central.connect(peripheral)
    }
}

extension PowerMeterService: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        for service in peripheral.services ?? [] {
            switch service.uuid {
            case powerService: peripheral.discoverCharacteristics([powerMeasurement], for: service)
            case batteryService: peripheral.discoverCharacteristics([batteryLevelChar], for: service)
            default: break
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        for characteristic in service.characteristics ?? [] {
            switch characteristic.uuid {
            case powerMeasurement:
                peripheral.setNotifyValue(true, for: characteristic)
            case batteryLevelChar:
                peripheral.readValue(for: characteristic)
                if characteristic.properties.contains(.notify) {
                    peripheral.setNotifyValue(true, for: characteristic)
                }
            default: break
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let data = characteristic.value else { return }
        switch characteristic.uuid {
        case powerMeasurement:
            if let measurement = CyclingPowerMeasurement(data: data) {
                handle(measurement, at: Date())
            }
        case batteryLevelChar:
            batteryLevel = parseBatteryLevel([UInt8](data))
        default: break
        }
    }
}
