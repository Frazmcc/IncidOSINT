export type Track = {
  id: string; kind: string; identifier: string; name: string;
  callsign: string; service: string; category: string;
  lat: number; lon: number; observedAt: number;
  speed: number | null; heading: number | null; altitude: number | null;
  onGround?: boolean | null; timeBasis: string; fleetStatus: string;
  notes: string; sourceUrl: string; typeCode?: string; territory?: string;
  squawk?: string | null; squawkObservedAt?: number;
};

export type AircraftSignal = {
  identifier: string; name: string; callsign: string; service: string;
  lastSeenAt: number; onGround?: boolean | null;
};

export type Feed = {
  records: Track[]; fetchedAt: number | null; provider: string;
  status: string; message: string; intervalSeconds: number;
  sources?: { name: string; status: string; fetchedAt: number | null; message?: string }[];
  nextPollAt?: number | null; blockedUntil?: number | null;
  collectionMode?: string; keyConfigured?: boolean;
  freshCount?: number; lastKnownCount?: number; unpositioned?: AircraftSignal[];
};
export type FastAircraftFeed = Partial<Feed> & { enabled: boolean };
export type LiveSnapshot = { servedAt: number; aircraft: Feed; vessels: Feed; error?: string };

export type Facility = {
  id: string; name: string; lat: number; lon: number; category: string;
  subtype: string; operator: string; country: string; description: string;
  source_data_url: string; source?: string; service_association?: string;
};
export type DirectoryEntry = {
  id: string; kind: string; identifier: string; name: string; category: string;
  service: string; notes?: string; identity_source?: string; typeCode?: string;
  icao_hex?: string; mmsi?: string; fleet_status?: string; status?: string;
};

export type RoutePoint = { lat: number; lon: number; at: number; ground?: boolean };
export type Flight = {
  id: string; points: RoutePoint[]; segments: RoutePoint[][];
  status: string; departureObserved: boolean; startedAt: number;
  endedAt?: number; stale: boolean; gaps: boolean; compacted?: boolean;
};
export type FlightHistory = {
  identifier: string; flight: Flight | null; captureBudgetPaused: boolean;
  message: string; error?: string;
};
export type VesselHistory = {
  identifier: string; hours: number; points: RoutePoint[]; segments: RoutePoint[][];
  firstAt: number | null; lastAt: number | null; gaps: boolean;
  partialWindow: boolean; recordingStartedAt: number | null;
  captureBudgetPaused: boolean; message: string; error?: string;
};

export type CollectorConfig = {
  url: string; accountId: string; planCheckedAt: number; collectorVersion: number;
};
export type CollectorStatus = {
  version?: number; active?: boolean; status?: string; connections?: number;
  subscriptionsAccepted?: number; compressedConnections?: number;
  decodedMessages?: number; decodeErrors?: number; binaryMessages?: number;
  lastMessageAt?: number; aircraft?: { state?: string }; vessels?: number;
  messagesToday?: number; lastPublishedAt?: number; error?: string;
};
export type CollectorSetup = {
  ready?: boolean; collector?: CollectorConfig | null; trackedMmsis?: number;
  status?: CollectorStatus; error?: string; message?: string;
};
export type AircraftSetup = {
  ready?: boolean; configured?: boolean; tier?: string | null;
  error?: string; message?: string;
};

export type FeedBudgetRow = {
  next_poll_at: number; blocked_until: number; window_start: number;
  requests: number; last_error?: string | null;
};

export type IncidentEvent={id:string;kind:"incident";title:string;summary:string;sourceName:string;sourceUrl:string|null;relatedLinks?:string[];attribution:string;licenceUrl?:string;confidence:"reported"|"inferred";category:string;eventType:string;eventAt:number;firstSeenAt:number;timeBasis:string;lat:number|null;lon:number|null;locationBasis:string;assetId?:string;assetName?:string;identifier?:string};
