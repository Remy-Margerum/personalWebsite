import CoreLocation
import CoreMotion
import Foundation
import Observation
import RideKit

/// GPS for position, speed and distance; the barometer (CMAltimeter) for
/// altitude and elevation gain, since GPS altitude is too noisy to sum.
@Observable
final class LocationService: NSObject {
    private(set) var authorization: CLAuthorizationStatus = .notDetermined
    private(set) var latestLocation: CLLocation?
    /// Barometric + GPS fused altitude (m), when the device provides it.
    private(set) var absoluteAltitude: Double?
    /// Metres climbed/descended since `startAltitudeTracking`, from the barometer.
    private(set) var relativeAltitude: Double?

    /// Every accepted location is delivered here (recorder + HealthKit route).
    @ObservationIgnored var onLocations: (([CLLocation]) -> Void)?

    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private var wantsUpdates = false
    @ObservationIgnored private let altimeter = CMAltimeter()

    override init() {
        super.init()
        manager.delegate = self
        manager.activityType = .fitness
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        manager.pausesLocationUpdatesAutomatically = false
        authorization = manager.authorizationStatus
    }

    var hasBarometer: Bool { CMAltimeter.isRelativeAltitudeAvailable() }

    func requestAuthorization() {
        manager.requestWhenInUseAuthorization()
    }

    /// Starts GPS. Called when the ride screen appears so there's a fix
    /// before you press Start, and kept running in the background while riding.
    func start() {
        wantsUpdates = true
        guard manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways
        else { return } // resumed from locationManagerDidChangeAuthorization
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
    }

    func stop() {
        wantsUpdates = false
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        stopAltitudeTracking()
    }

    func startAltitudeTracking() {
        relativeAltitude = nil
        if CMAltimeter.isRelativeAltitudeAvailable() {
            altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] data, _ in
                guard let data else { return }
                self?.relativeAltitude = data.relativeAltitude.doubleValue
            }
        }
        if CMAltimeter.isAbsoluteAltitudeAvailable() {
            altimeter.startAbsoluteAltitudeUpdates(to: .main) { [weak self] data, _ in
                guard let data else { return }
                self?.absoluteAltitude = data.altitude
            }
        }
    }

    func stopAltitudeTracking() {
        altimeter.stopRelativeAltitudeUpdates()
        altimeter.stopAbsoluteAltitudeUpdates()
    }

    /// Best available altitude for the ride record.
    var altitude: Double? {
        if let absoluteAltitude { return absoluteAltitude }
        guard let location = latestLocation, location.verticalAccuracy >= 0 else { return nil }
        return location.altitude
    }
}

extension LocationService: CLLocationManagerDelegate {
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorization = manager.authorizationStatus
        if wantsUpdates { start() }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        // Ignore cached fixes delivered on startup.
        let fresh = locations.filter { abs($0.timestamp.timeIntervalSinceNow) < 10 && $0.horizontalAccuracy >= 0 }
        guard let last = fresh.last else { return }
        latestLocation = last
        onLocations?(fresh)
    }
}

extension CLLocation {
    var fix: LocationFix {
        LocationFix(timestamp: timestamp, latitude: coordinate.latitude, longitude: coordinate.longitude,
                    horizontalAccuracy: horizontalAccuracy, speed: speed)
    }
}
