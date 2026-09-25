# Bike Computer (iOS)

A personal cycling app for iPhone. It records:

| Data | Source | How |
|---|---|---|
| Heart rate | AirPods Pro 3 | HealthKit `HKWorkoutSession` + `HKLiveWorkoutBuilder` (iPhone, iOS 26+) |
| Power, L/R balance | Favero Assioma pedals | Bluetooth Cycling Power Service `0x1818`, measurement `0x2A63` |
| Cadence | Favero Assioma pedals | Crank revolution data in that same power measurement |
| Speed, distance, route | iPhone GPS | CoreLocation, filtered for accuracy and jitter |
| Altitude, elevation gain | iPhone barometer | CoreMotion `CMAltimeter` (falls back to GPS altitude) |

Rides are saved on the phone as JSON and TCX files, saved to Apple Health as
outdoor cycling workouts, and can be uploaded to Intervals.icu, which feeds
the `/cycling` page of this site.

## Layout

```
ios/BikeComputer/
  project.yml                XcodeGen spec (generates the .xcodeproj)
  RideKit/                   Swift package, no iOS dependencies, unit-tested
    CyclingPowerMeasurement  parses 0x2A63 packets (power, balance, crank data)
    CadenceCalculator        crank revs → rpm, with counter wrap and coasting
    RideMetrics              GPS distance filter, elevation hysteresis, rolling avg
    Ride                     1 Hz samples, summary (avg/NP/max), 5 s buckets
    TCXWriter                TCX export with HR, cadence, speed and power
  BikeComputer/              the iOS app
    Sensors/PowerMeterService      CoreBluetooth: scan, pair, auto-reconnect
    Sensors/WorkoutSessionService  HealthKit: heart rate in, workout out
    Sensors/LocationService        GPS + barometer
    Recording/RideRecorder         combines them, samples at 1 Hz
    Storage/                       ride files, Intervals.icu upload, Keychain
    Views/                         Ride, Sensors, History, Settings screens
```

```
 AirPods Pro 3 ──HealthKit──► WorkoutSessionService ─┐
 Assioma ───BLE 0x2A63──────► PowerMeterService ──────┼─► RideRecorder (1 Hz) ─► RideStore (JSON + TCX)
 GPS + barometer ───────────► LocationService ────────┘        │                  ├─► Apple Health workout
                                                               └─► live dashboard └─► Intervals.icu → /cycling
```

## Running it

You need a Mac with Xcode 26 and an iPhone on iOS 26 or later. The
simulator has no Bluetooth or heart rate, so use a real phone.

1. `brew install xcodegen`
2. `cd ios/BikeComputer && xcodegen`
3. Open `BikeComputer.xcodeproj`. Under **Signing & Capabilities**, pick your
   team. HealthKit is already in the entitlements.
4. Plug in the iPhone and run.

Signing: HealthKit (AirPods heart rate and the Apple Health save) needs the
paid Apple Developer Program, US$99 a year. Apple's capability table doesn't
offer HealthKit to free Apple ID teams. With the paid program, builds last a
year and you can install through TestFlight. A free team could only run a
version without HealthKit (pedals and GPS only), and it would expire every 7
days.

To test the logic without a phone, run this on macOS or Linux:

```
cd ios/BikeComputer/RideKit && swift test
```

## Using it

1. **Pair the pedals once.** Open **Sensors**, spin the cranks to wake the
   Assioma pedals, then tap **Scan** and choose them. After that the app
   reconnects on its own, including after dropouts mid-ride.
2. **Heart rate.** Wear at least one AirPod Pro 3. Heart rate appears after
   you press **Start**, because HealthKit only streams it while a workout
   session is running. The first ride asks for Health permissions.
   California Vehicle Code 27400 bans earbuds in *both* ears while cycling,
   and one bud is enough for heart rate.
3. **Ride.** The screen stays on while recording. Pause and resume are
   manual. **Finish** lets you save or discard the ride.
4. **After the ride.** Under **History**, you can **Export TCX** (share
   sheet, Files, Strava) or **Upload to Intervals.icu** (add your API key in
   **Settings** first). The site's hourly sync picks up uploaded rides.

## Things to check on the first real rides

Some of this can't be verified without real hardware:

- [ ] AirPods Pro 3 heart rate appears on the dashboard within ~30 s of
      Start, and stays when the phone is locked in a pocket or on a mount.
- [ ] The Assioma packets set the crank-data flag, so cadence shows up. If
      cadence is always `--`, log the raw flags in `PowerMeterService`.
- [ ] Power and cadence match your head unit or the Cadence app within a few
      watts and rpm.
- [ ] GPS keeps recording with the screen locked for a whole ride. The
      `location` background mode should keep the app alive; watch battery use.
- [ ] Distance and climbing are close to Intervals.icu's numbers for the same
      ride. Tune `DistanceAccumulator` and `ElevationGainAccumulator`
      thresholds if not.
- [ ] The Apple Health workout has route, power, cadence and distance, with no
      doubled distance. HealthKit's own distance collection is turned off, and
      distance comes only from our GPS track.
- [ ] The TCX uploads to Intervals.icu and shows HR, power and cadence streams.

## Known limits

- **Heart rate only.** AirPods Pro 3 give HealthKit heart-rate samples, but no
  HRV or beat-to-beat data (confirmed by Apple on the developer forums).
- **Assioma Bluetooth slots.** If a head unit also connects to the pedals
  over Bluetooth, the phone may not get a connection. Pair the head unit
  over ANT+ instead.
- **App killed mid-ride.** The ride in memory is lost. Crash recovery is on
  the roadmap below.
- **Native only.** HealthKit and CoreBluetooth aren't available to web pages,
  so this can't be a page on the website itself.

## Roadmap

1. **Hardening.** Save the in-progress ride to disk every minute and recover
   it at launch. Use HealthKit's `recoverActiveWorkoutSession` to reattach
   the workout session.
2. **Assioma zero-offset calibration.** Write opcode `0x0C` to the Cycling
   Power Control Point (`0x2A66`) before rides. The pedals need this
   periodically.
3. **Auto-pause** below ~1.5 m/s, and **laps** (a lap button, laps in TCX).
4. **Lock-screen Live Activity** showing power, HR and speed.
5. **FIT export.** It's more compact than TCX and keeps L/R balance. Intervals
   and Strava both prefer it.
6. **Extra sensors.** A separate speed/cadence sensor (CSC `0x1816`) for
   tunnels and trainers, and a direct Bluetooth HR strap fallback.
7. **Training.** FTP-based power zones, HR zones and interval targets.

## Sources

- [Track heart rate during workouts with AirPods Pro 3 (Apple Support)](https://support.apple.com/guide/airpods/track-heart-rate-workouts-airpods-pro-3-dev1b40fb47d/web)
- [Track workouts with HealthKit on iOS and iPadOS (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/322/)
- [AirPods Pro 3 HRV data access (Apple Developer Forums)](https://developer.apple.com/forums/thread/805536)
- [CMHeadphoneMotionManager](https://developer.apple.com/documentation/coremotion/cmheadphonemotionmanager) (head motion, not used yet)
- Bluetooth SIG Cycling Power Service / Profile specifications
- [Intervals.icu API](https://intervals.icu/api-docs.html)
