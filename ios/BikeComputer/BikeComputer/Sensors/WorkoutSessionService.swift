import CoreLocation
import Foundation
import HealthKit
import Observation
import RideKit

/// Runs an HKWorkoutSession on iPhone (iOS 26+). While it runs, HealthKit
/// collects heart rate from AirPods Pro 3 (with at least one bud in), and
/// from Powerbeats Pro 2 or a paired Bluetooth HR strap, and hands it to us
/// through HKLiveWorkoutBuilder. At the end the ride is saved to Apple Health
/// as an outdoor cycling workout with route, power, cadence and distance.
@Observable
final class WorkoutSessionService: NSObject {
    private(set) var heartRate: Int?
    private(set) var lastHeartRateAt: Date?
    private(set) var sessionState: HKWorkoutSessionState = .notStarted
    private(set) var lastError: String?

    @ObservationIgnored let healthStore = HKHealthStore()
    @ObservationIgnored private var session: HKWorkoutSession?
    @ObservationIgnored private var builder: HKLiveWorkoutBuilder?
    @ObservationIgnored private var routeBuilder: HKWorkoutRouteBuilder?

    static var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    private static let bpm = HKUnit.count().unitDivided(by: .minute())

    @MainActor
    func requestAuthorization() async {
        guard Self.isAvailable else { return }
        let share: Set<HKSampleType> = [
            HKObjectType.workoutType(),
            HKSeriesType.workoutRoute(),
            HKQuantityType(.distanceCycling),
            HKQuantityType(.cyclingPower),
            HKQuantityType(.cyclingCadence),
            HKQuantityType(.activeEnergyBurned),
        ]
        let read: Set<HKObjectType> = [
            HKQuantityType(.heartRate),
            HKQuantityType(.activeEnergyBurned),
            HKObjectType.workoutType(),
        ]
        do {
            try await healthStore.requestAuthorization(toShare: share, read: read)
        } catch {
            lastError = error.localizedDescription
        }
    }

    @MainActor
    func start(at date: Date) async throws {
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .cycling
        configuration.locationType = .outdoor

        let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
        let builder = session.associatedWorkoutBuilder()
        let dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: configuration)
        // Distance comes from our own filtered GPS track (added at the end),
        // so stop HealthKit from also collecting it and double counting.
        dataSource.disableCollection(for: HKQuantityType(.distanceCycling))
        builder.dataSource = dataSource
        session.delegate = self
        builder.delegate = self

        self.session = session
        self.builder = builder
        routeBuilder = HKWorkoutRouteBuilder(healthStore: healthStore, device: nil)
        heartRate = nil
        lastError = nil

        session.startActivity(with: date)
        try await builder.beginCollection(at: date)
    }

    func pause() { session?.pause() }
    func resume() { session?.resume() }

    /// Streams GPS points into the workout route as they arrive.
    func addRoute(_ locations: [CLLocation]) {
        guard !locations.isEmpty, let routeBuilder else { return }
        routeBuilder.insertRouteData(locations) { [weak self] _, error in
            if let error { DispatchQueue.main.async { self?.lastError = error.localizedDescription } }
        }
    }

    /// Ends the session and saves the workout with power, cadence and
    /// distance samples built from the recorded ride.
    @MainActor
    func finish(ride: Ride) async throws {
        guard let session, let builder else { return }
        defer { reset() }

        let samples = Self.quantitySamples(for: ride)
        if !samples.isEmpty {
            try await builder.addSamples(samples)
        }
        session.end()
        try await builder.endCollection(at: ride.endDate)
        if let workout = try await builder.finishWorkout(), let routeBuilder {
            _ = try await routeBuilder.finishRoute(with: workout, metadata: nil)
        }
    }

    /// Ends the session without saving anything to Apple Health.
    @MainActor
    func discard() {
        session?.end()
        builder?.discardWorkout()
        routeBuilder?.discard()
        reset()
    }

    /// Heart rate older than 10 s is treated as missing (AirPods out of ear,
    /// poor fit or disconnected).
    func expireStaleReadings(now: Date) {
        if let last = lastHeartRateAt, now.timeIntervalSince(last) > 10 {
            heartRate = nil
        }
    }

    private func reset() {
        session = nil
        builder = nil
        routeBuilder = nil
        heartRate = nil
        lastHeartRateAt = nil
    }

    static func quantitySamples(for ride: Ride) -> [HKQuantitySample] {
        let cadenceUnit = HKUnit.count().unitDivided(by: .minute())
        var samples: [HKQuantitySample] = []
        for bucket in ride.buckets(seconds: 5) {
            if let watts = bucket.averagePower {
                samples.append(HKQuantitySample(
                    type: HKQuantityType(.cyclingPower),
                    quantity: HKQuantity(unit: .watt(), doubleValue: watts),
                    start: bucket.start, end: bucket.end))
            }
            if let rpm = bucket.averageCadence {
                samples.append(HKQuantitySample(
                    type: HKQuantityType(.cyclingCadence),
                    quantity: HKQuantity(unit: cadenceUnit, doubleValue: rpm),
                    start: bucket.start, end: bucket.end))
            }
            if bucket.distance > 0 {
                samples.append(HKQuantitySample(
                    type: HKQuantityType(.distanceCycling),
                    quantity: HKQuantity(unit: .meter(), doubleValue: bucket.distance),
                    start: bucket.start, end: bucket.end))
            }
        }
        return samples
    }
}

extension WorkoutSessionService: HKLiveWorkoutBuilderDelegate {
    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        let heartRateType = HKQuantityType(.heartRate)
        guard collectedTypes.contains(heartRateType),
              let quantity = workoutBuilder.statistics(for: heartRateType)?.mostRecentQuantity()
        else { return }
        let value = Int(quantity.doubleValue(for: Self.bpm).rounded())
        DispatchQueue.main.async {
            self.heartRate = value
            self.lastHeartRateAt = Date()
        }
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}

extension WorkoutSessionService: HKWorkoutSessionDelegate {
    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
                        from fromState: HKWorkoutSessionState, date: Date) {
        DispatchQueue.main.async { self.sessionState = toState }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        DispatchQueue.main.async { self.lastError = error.localizedDescription }
    }
}
