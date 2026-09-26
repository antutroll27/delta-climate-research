# AQI API and Device Contract

**Version:** Draft 0.2  
**Date:** 25 September 2026  
**Status:** Government-station API proposed; device contract deferred  
**Related:** [System architecture](./02-system-architecture.md)

The current delivery scope covers one same-origin TypeScript read endpoint backed by
government monitoring stations. Sections concerning `/api/telemetry` and ESP32
authentication are a future contract and should not be implemented as part of the
first AQI release.

## 1. Contract principles

- Every public response declares a `schema_version`; breaking changes require a new
  route or major schema version.
- JSON field names use `snake_case` consistently across TypeScript and future device
  firmware.
- All timestamps are RFC 3339 UTC timestamps ending in `Z`.
- Geographic coordinates are WGS 84 decimal degrees.
- Pollutant values always include units.
- A missing value is omitted or `null` according to the schema; it is never zero.
- Responses distinguish observation, receipt, calculation and service times.
- Mutating requests support safe retries through idempotency or device sequence IDs.
- Every derived AQI result identifies its standard and algorithm version.

## 2. Proposed public endpoints

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/air-quality?area_id={area_id}` | **Initial:** latest supported air-quality result for an allowlisted OBOS area |
| `GET` | `/api/air-quality-history?area_id={area_id}` | **Deferred:** bounded history after durable storage is justified |
| `GET` | `/api/stations?area_id={area_id}` | **Deferred:** qualifying station metadata for an OBOS area |
| `POST` | `/api/telemetry` | **Deferred:** authenticated OBOS-device batch ingestion |
| `GET` | `/api/device-latest?device_id={device_id}` | **Deferred:** latest normalized readings for an authorized device/client |

Administrative provisioning, credential rotation and calibration routes should not
be exposed until an authenticated operations interface exists.

## 3. Area air-quality response

Example:

```json
{
  "schema_version": "1.0",
  "status": "available",
  "area_id": "in/kolkata/ballygunge",
  "area_name": "Ballygunge",
  "coverage": {
    "status": "inside_area",
    "geometry_version": "obos-areas-2026-09",
    "distance_m": 0
  },
  "instrument": {
    "id": "openaq:10918",
    "name": "Ballygunge",
    "class": "regulatory_station",
    "provider": "OpenAQ",
    "owner": "WBPCB/CPCB",
    "latitude": 22.0,
    "longitude": 88.0
  },
  "aqi": {
    "value": 142,
    "category": "moderately_polluted",
    "standard": "in_cpcb",
    "dominant_pollutant": "pm2_5",
    "algorithm_version": "cpcb-aqi-1.0"
  },
  "pollutants": [
    {
      "parameter": "pm2_5",
      "concentration": 68.4,
      "unit": "ug_m3",
      "averaging_period_hours": 24,
      "observation_count": 22,
      "sub_index": 142,
      "quality": "valid"
    }
  ],
  "window_start": "2026-09-24T12:00:00Z",
  "window_end": "2026-09-25T12:00:00Z",
  "observed_at": "2026-09-25T12:00:00Z",
  "computed_at": "2026-09-25T12:03:10Z",
  "served_at": "2026-09-25T12:05:00Z",
  "source": {
    "kind": "measured",
    "provider": "OpenAQ",
    "licence": "provider_reported",
    "attribution": "OpenAQ; originating provider WBPCB/CPCB"
  },
  "quality_flags": []
}
```

The coordinates and values above illustrate the contract and are not authoritative
station data. Tests must use named fixtures rather than copying this example.

### No-coverage response

A valid request with no suitable instrument should normally return `200` with a
typed coverage result, because absence is a meaningful product state:

```json
{
  "schema_version": "1.0",
  "status": "no_station",
  "area_id": "in/kolkata/baruipur",
  "coverage": {
    "status": "no_station",
    "geometry_version": "obos-areas-2026-09",
    "message": "No qualifying continuous monitoring station was found for this area."
  },
  "instrument": null,
  "aqi": null,
  "pollutants": [],
  "observed_at": null,
  "served_at": "2026-09-25T12:05:00Z",
  "quality_flags": ["no_continuous_station"]
}
```

## 4. ESP32 telemetry request

The device sends a batch so temporary connectivity loss does not destroy readings.

```json
{
  "schema_version": "1.0",
  "device_id": "obos-kol-001",
  "firmware_version": "0.1.0",
  "batch_id": "0199a184-cc18-7e25-992f-8d9858f082a0",
  "sent_at": "2026-09-25T12:35:04Z",
  "readings": [
    {
      "sequence": 1842,
      "recorded_at": "2026-09-25T12:30:00Z",
      "measurements": [
        {
          "parameter": "pm2_5",
          "value": 42.7,
          "unit": "ug_m3",
          "sensor_channel": "pms5003"
        },
        {
          "parameter": "pm10",
          "value": 78.1,
          "unit": "ug_m3",
          "sensor_channel": "pms5003"
        },
        {
          "parameter": "temperature",
          "value": 31.4,
          "unit": "celsius",
          "sensor_channel": "sht4x"
        },
        {
          "parameter": "relative_humidity",
          "value": 73.2,
          "unit": "percent",
          "sensor_channel": "sht4x"
        }
      ],
      "diagnostics": {
        "battery_v": 4.01,
        "rssi_dbm": -67,
        "uptime_s": 391202
      }
    }
  ]
}
```

Recommended headers:

```text
Content-Type: application/json
X-OBOS-Device: obos-kol-001
X-OBOS-Key-Id: key-2026-01
X-OBOS-Timestamp: 1790339704
X-OBOS-Nonce: 1842
X-OBOS-Signature: v1=<hex-hmac-sha256>
Idempotency-Key: 0199a184-cc18-7e25-992f-8d9858f082a0
```

Canonical signing, including header order and body hashing, must be specified with
test vectors before firmware implementation. TLS remains mandatory; the signature
does not replace it.

### Telemetry acknowledgement

```json
{
  "batch_id": "0199a184-cc18-7e25-992f-8d9858f082a0",
  "status": "accepted",
  "accepted_sequences": [1842],
  "duplicate_sequences": [],
  "rejected": [],
  "server_time": "2026-09-25T12:35:05Z"
}
```

The device may discard only acknowledged sequences. Partial validation failure must
name rejected sequences and reasons without requiring valid readings to be sent
again.

## 5. Telemetry validation

The future ingestion function or service should validate:

- registered, active device and credential;
- signature and allowed clock skew;
- unique batch ID and monotonically increasing sequence;
- maximum readings per batch and maximum body size;
- timestamps within the permitted offline-upload window;
- recognized parameters and units;
- finite values inside broad physical plausibility bounds;
- sensor channel declared in the device manifest; and
- firmware/schema version compatibility.

Plausibility validation should create flags before it deletes evidence. A physically
unlikely reading can be scientifically useful when diagnosing a sensor. Reject only
values that cannot be represented safely or violate the contract; quarantine or
flag the rest.

## 6. Device quality metadata

Each provisioned device needs:

- stable device and sensor serial IDs;
- hardware revision and firmware version;
- installation coordinate, height and environment notes;
- deployment start/end times;
- calibration coefficients and reference-instrument evidence;
- inlet and enclosure configuration;
- maintenance and sensor-replacement history; and
- current operational state.

Particulate sensors are sensitive to humidity, ageing, placement and unit-to-unit
variation. An OBOS device is not equivalent to a reference-grade regulatory station.
The UI and API should identify it as an OBOS sensor and carry its calibration state.

## 7. Error envelope

Errors should use one stable shape:

```json
{
  "schema_version": "1.0",
  "error": {
    "code": "invalid_parameter_unit",
    "message": "The unit is not valid for this parameter.",
    "request_id": "req_01J...",
    "details": {
      "parameter": "pm2_5",
      "unit": "ppm"
    }
  }
}
```

Suggested status policy:

| Status | Use |
|---|---|
| `400` | Malformed request or unsupported query |
| `401` | Missing or invalid device authentication |
| `403` | Known credential lacks permission or is revoked |
| `404` | Unknown area, station or device resource |
| `409` | Sequence/idempotency conflict that cannot be treated as a safe duplicate |
| `413` | Batch exceeds the payload limit |
| `422` | Schema-valid JSON with invalid field values |
| `429` | Rate limit exceeded |
| `502` | Required upstream provider failed and no usable cached result exists |
| `503` | OBOS dependency unavailable |

## 8. Shared TypeScript contract

The Vercel Function and Astro interface should import the same domain types from
`src/lib/aqi/types.ts`. Define `AirQualityResponse` as a discriminated union over
`status`, covering at least:

```text
available
no_station
insufficient_data
stale
source_unavailable
```

Static TypeScript types do not validate network responses. Runtime schemas or
explicit type guards in `src/lib/aqi/schemas.ts` must validate OpenAQ, data.gov.in
and the final public response. Provider fixtures must cover missing, renamed,
malformed and non-finite values.

Astro components call one wrapper such as `getAreaAirQuality(areaId)`. They must not
issue ad hoc provider requests or receive provider credentials.

## 9. Compatibility policy

- Additive optional fields are permitted within schema `1.x`.
- Renaming, deleting, changing a unit or making an optional field required needs a
  new major schema version or route plus a migration window.
- Algorithm changes do not overwrite historical results; they create a new
  `algorithm_version` and may trigger an explicit backfill.
- Device firmware declares the telemetry schema version in every batch.
- The future ingestion function or service should support at least the currently
  deployed and immediately prior firmware schema during controlled upgrades.
