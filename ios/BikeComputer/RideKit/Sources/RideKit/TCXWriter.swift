import Foundation

/// Writes a ride as Garmin TCX, which Intervals.icu, Strava and most training
/// tools import with GPS, altitude, heart rate, cadence, speed and power.
/// Element order follows the TrainingCenterDatabase v2 schema.
public enum TCXWriter {
    public static func tcx(for ride: Ride) -> String {
        let summary = ride.summary
        var xml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" \
        xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
          <Activities>
            <Activity Sport="Biking">
              <Id>\(timestamp(ride.startDate))</Id>
              <Lap StartTime="\(timestamp(ride.startDate))">
                <TotalTimeSeconds>\(number(ride.movingTime, 0))</TotalTimeSeconds>
                <DistanceMeters>\(number(summary.distance, 1))</DistanceMeters>

        """
        if let maxSpeed = summary.maxSpeed {
            xml += "        <MaximumSpeed>\(number(maxSpeed, 2))</MaximumSpeed>\n"
        }
        xml += "        <Calories>0</Calories>\n"
        if let avgHR = summary.averageHeartRate, let maxHR = summary.maxHeartRate {
            xml += "        <AverageHeartRateBpm><Value>\(Int(avgHR.rounded()))</Value></AverageHeartRateBpm>\n"
            xml += "        <MaximumHeartRateBpm><Value>\(maxHR)</Value></MaximumHeartRateBpm>\n"
        }
        xml += "        <Intensity>Active</Intensity>\n"
        if let cadence = summary.averageCadence {
            xml += "        <Cadence>\(min(254, Int(cadence.rounded())))</Cadence>\n"
        }
        xml += "        <TriggerMethod>Manual</TriggerMethod>\n"
        xml += "        <Track>\n"
        for sample in ride.samples {
            xml += trackpoint(sample)
        }
        xml += """
                </Track>
              </Lap>
              <Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
                <Name>BikeComputer</Name>
              </Creator>
            </Activity>
          </Activities>
        </TrainingCenterDatabase>

        """
        return xml
    }

    private static func trackpoint(_ s: RideSample) -> String {
        var tp = "          <Trackpoint>\n"
        tp += "            <Time>\(timestamp(s.timestamp))</Time>\n"
        if let lat = s.latitude, let lon = s.longitude {
            tp += "            <Position><LatitudeDegrees>\(number(lat, 7))</LatitudeDegrees>"
            tp += "<LongitudeDegrees>\(number(lon, 7))</LongitudeDegrees></Position>\n"
        }
        if let alt = s.altitude {
            tp += "            <AltitudeMeters>\(number(alt, 1))</AltitudeMeters>\n"
        }
        tp += "            <DistanceMeters>\(number(s.distance, 1))</DistanceMeters>\n"
        if let hr = s.heartRate, hr > 0 {
            tp += "            <HeartRateBpm><Value>\(min(255, hr))</Value></HeartRateBpm>\n"
        }
        if let cadence = s.cadence {
            tp += "            <Cadence>\(min(254, max(0, cadence)))</Cadence>\n"
        }
        if s.speed != nil || s.power != nil {
            tp += "            <Extensions><ns3:TPX>"
            if let speed = s.speed, speed >= 0 { tp += "<ns3:Speed>\(number(speed, 2))</ns3:Speed>" }
            if let power = s.power { tp += "<ns3:Watts>\(max(0, power))</ns3:Watts>" }
            tp += "</ns3:TPX></Extensions>\n"
        }
        tp += "          </Trackpoint>\n"
        return tp
    }

    private static let dateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter
    }()

    private static func timestamp(_ date: Date) -> String {
        dateFormatter.string(from: date)
    }

    /// Locale-independent fixed-point formatting (always a "." separator).
    private static func number(_ value: Double, _ decimals: Int) -> String {
        String(format: "%.\(decimals)f", value)
    }
}
