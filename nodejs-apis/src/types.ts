// ---- Rest apis
export interface RestApi {
    get?: RestApiHandler | RestEndpointDescriptor;
    post?: RestApiHandler | RestEndpointDescriptor;
    delete?: RestApiHandler | RestEndpointDescriptor;
    put?: RestApiHandler | RestEndpointDescriptor;
}

export interface RestEndpointDescriptor {
    fullHandler?: RestApiFullHandler;
    handler?: RestApiHandler;
    description?: string;
    querySchema?: object;
}

/** Authenticated caller attached to a request by the auth gate. */
export interface AuthPrincipal {
    /** Account name owning the token. */
    user: string;
    /** Id of the token record (so a request can revoke itself). */
    tokenId: string;
    /** App registration name (`Web UI`, `Node-RED`…). */
    name: string;
    kind: 'session' | 'api';
}

export interface RestApiHandlerParams {
    query: any;
    body: any;
    params: any;
    headers: { [key: string]: string };
    /** Express request extras used by the auth endpoints. */
    ip?: string;
    socket?: any;
    method?: string;
    /** Set by `authGate` when the request carries a valid token. */
    user?: AuthPrincipal;
}

export type RestApiHandler = (
    params: RestApiHandlerParams
) => Promise<void | undefined | object>;

export type RestApiFullHandler = (
    params: RestApiHandlerParams,
    res: any
) => Promise<void>;

export type RestApis = { [route: string]: RestApi };

// --- Echo

/** Payload of the `versions` message sent by an echo on every connect. */
export interface EchoVersions {
    /** ESP32HomeAssistant library version. */
    lib?: string;
    /** Device firmware version (`HAConfig::deviceVersion`). */
    device?: string;
    /** Device type (`echo-zero`, `echo-dashboard`…). */
    type?: string;
    /** MAC address: canonical identity of the device. */
    mac?: string;
}

/**
 * OTA bookkeeping stored in the settings document of a device.
 * It keeps the automatic update from turning into a reboot loop when the
 * firmware that gets flashed keeps reporting the same old version.
 */
export interface EchoOtaState {
    /** Last time the server asked the device to update. */
    lastAttemptAt?: Date;
    /** Attempts made while the device reported the same version. */
    attempts?: number;
    /** Version the device reported when the attempts were counted. */
    reportedVersion?: string;
    /** True when the max attempts were reached: no more automatic retries. */
    stuck?: boolean;
    /** Result of the last version check (`up-to-date`, `update-available`…). */
    lastStatus?: string;
}

/** Document of the `echo_settings` collection. */
export interface EchoSettings {
    _id?: unknown;
    /** IP of the last connection (the live one while the device is connected). */
    ip?: string;
    /** Canonical identity, set as soon as a device reports it. */
    mac?: string;
    deviceType?: string;
    versions?: EchoVersions;
    serverIp?: string;
    wakeWordAccuracy?: number;
    screens?: {
        refreshTime?: number;
        screens?: {
            k: number;
            texts?: {
                ts?: number;
                v: string;
                cx?: number;
                cy?: number;
                r?: number;
            }[];
        }[];
    };
    /** Last time the device reported its versions. */
    lastSeen?: Date;
    /** Automatic OTA bookkeeping (cooldown, attempts, stuck flag). */
    ota?: EchoOtaState;
}

// --- Tools

export interface ConversationMemory {
    /** True when one of these intents was already executed in the conversation. */
    hasIntent: (intent: string[]) => boolean;
}

/** Runtime context passed to a tool executor (recognized user / session). */
export interface ToolExecutionContext {
    user?: string;
    sessionId?: string;
    memory?: ConversationMemory;
}

export interface ToolExecutor<P> {
    exec: (
        params?: P,
        ctx?: ToolExecutionContext
    ) => Promise<string | void | boolean>;
}

export interface Tool<P> extends ToolExecutor<P> {
    description?: string;
    inputSchema?: any;
    disabled?: boolean;
    instance?: any;
}

export type Tools = { [name: string]: Tool<any> };
export type ToolsExecutors = { [name: string]: ToolExecutor<any> };

export interface ToolSchema {
    type: string;
    function?: {
        name: string;
        description: string;
        parameters: any;
    };
}

export type ToolsSchema = ToolSchema[];

export interface ToolPlugin {
    name: string;
    host: string;
}

// --- Devices, Room, providers
export interface Device {
    _id?: string;
    name: string;
    externalId: string;
    provider: string;
    type: string;
    /** Originating integration when the provider is a gateway: the HA
     *  integration platform (`melcloud`, `tradfri`, `shelly`…). Used by the UI
     *  to pick a renderer (`<type>/<integration>`) and to group devices. */
    integration?: string;
    state?: DeviceState;
    properties?: Record<string, PropertyValue>;
}

export enum DeviceTypes {
    light = 'light',
    switch = 'switch',
    shutter = 'shutter',
    sprinkler = 'sprinkler',
    tv = 'tv',
    sensor = 'sensor',
    thermostat = 'thermostat',
    button = 'button',
    camera = 'camera',
    unknown = 'unknown',
}

export interface Room {
    _id: string;
    name: string;
    internalId: string;
    devices?: string[];
    icon?: string;
}

export type ProviderType = 'gateway' | 'direct' | 'cloud';

export interface Provider {
    _id?: string;
    name: string;
    codesource: string;
    type?: ProviderType;
    mac?: string;
    host?: string;
    user?: string;
    password?: string;
    properties?: Record<string, PropertyValue>;
    multidevices?: boolean;
}

export type PowerType = 'on' | 'off' | 'pause';

export type PropertyValue = string | number | boolean;

export interface DeviceState {
    power?: PowerType;
    level?: number;
    properties?: Record<string, PropertyValue>;
}

export interface ProviderFunction {
    name: string;
    params?: object;
}

/**
 * One input of a provider function, rendered as a control by the frontend
 * (and described to the LLM through `ProviderFunction.params`).
 */
export interface FunctionInputField {
    key: string;
    label: string;
    type: 'string' | 'number' | 'boolean';
    /** Enum values known up-front. */
    options?: { value: string; label: string }[];
    /**
     * Enum values discovered at runtime: the frontend calls `call` and maps each
     * returned row (`value` field → the parameter, `args` fields → sibling
     * parameters). E.g. `setPlayContent.uri` ← `getSourceList` rows.
     */
    optionsFrom?: {
        call: string;
        value: string;
        label: string;
        args?: string[];
    };
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    required?: boolean;
}

export interface ProviderFunctionDef extends ProviderFunction {
    returns?: object;
    inputSchema?: FunctionInputField[];
    description?: string;
    /**
     * Handled by the device's own panel (e.g. volume/mute live on the type
     * panel) — excluded from the generic grid, still callable by the agent.
     */
    hidden?: boolean;
}

/**
 * One property exposed by a provider: drives the generic control renderer
 * (`DeviceControls/GenericControls`) and the history-chart metric picker.
 * `key` refers to `DeviceState.properties[key]` (or `state.level` for `level`).
 */
export interface StatePropertySchema {
    key: string;
    label: string;
    /**
     * `multienum`: several `options` at once, carried as a CSV string (the flat
     * `PropertyValue` vocabulary has no arrays) — e.g. a camera's vision modes.
     */
    type: 'boolean' | 'number' | 'range' | 'enum' | 'multienum' | 'string';
    /**
     * Allowed values for `enum` properties. `description` is an optional one-line
     * hint for that value (e.g. what a vision mode does), rendered beside it.
     */
    options?: { value: string; label: string; description?: string }[];
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    /** One line under the control: what the field does. */
    description?: string;
    /** Telemetry: displayed by the UI, never sent back to the device. */
    readonly?: boolean;
}

export interface DeviceCapabilities {
    /** Property schema of the device state (canonical property vocabulary). */
    state?: StatePropertySchema[];
    /** @deprecated legacy name for `state`; normalized in getDeviceCapabilities. */
    stateSchema?: StatePropertySchema[];
    functions?: ProviderFunctionDef[];
    /** Frontend control-panel profile id (e.g. `clim`) → CUSTOM_CONTROLS key.
     *  Lets a provider choose a hand-authored renderer whatever its
     *  `codesource` is (all HA integrations share `codesource: homeassistant`). */
    control?: string;
}

export interface ProviderApiMetaInfo {
    device: Device;
    provider: Provider;
}

export interface DiscoveredDevice {
    name: string;
    type: string;
    externalId?: string;
    mac?: string;
    host?: string;
    category?: string;
}

export interface DiscoveryResult {
    devices: DiscoveredDevice[];
    // public: DiscoveredDevice[]
    // private: DiscoveredDevice[]
}

export interface ProviderApi {
    init?: (provider: Provider) => Promise<boolean>;
    // discover?: (provider: Provider) => Promise<DiscoveryResult>; // TODO just keep one function, can remove publicDiscover
    discover?: (provider?: Provider) => Promise<DiscoveryResult>;
    publicDiscover?: () => Promise<DiscoveryResult>;
    changeDeviceState?: (
        meta: ProviderApiMetaInfo,
        params: DeviceState
    ) => Promise<DeviceState | boolean>;
    getDeviceState?: (meta: ProviderApiMetaInfo) => Promise<DeviceState>;
    /**
     * The device's **durable property bag** (`Device.properties`) — config that
     * must survive a state write.
     */
    getDeviceProperties?: (
        meta: ProviderApiMetaInfo
    ) => Promise<Record<string, PropertyValue>>;
    changeDeviceProperties?: (
        meta: ProviderApiMetaInfo,
        patch: Record<string, PropertyValue>
    ) => Promise<Record<string, PropertyValue>>;
    getCapabilities?: (
        meta: ProviderApiMetaInfo
    ) => Promise<DeviceCapabilities>;
    callFunction?: (
        meta: ProviderApiMetaInfo,
        fnt: ProviderFunction
    ) => Promise<any>;
    isInitialized?: () => Promise<boolean>;
}

export interface ProvidersApis {
    api: ProviderApi;
    restApi?: RestApis;
    tools?: Tools;
    settings?: StatePropertySchema[];
    /** REST base path override (default: lowercased provider-row name).
     *  Lets a provider mount its routes even before a provider row exists /
     *  with a stable path (e.g. Home Assistant → 'ha'). */
    restApiBasePath?: string;
    /** Startup hook invoked by init.ts (fire-and-forget). Providers define
     *  their own listeners here (event subscriptions, row seeding, MQTT…). */
    onBoot?: () => Promise<void>;
}

/** A topic subscriber registered by a provider / module. */
export type MqttSubscriber = (data: string) => Promise<void> | void;

export interface ProvidersApisPlugin {
    name: string;
    host: string;
    type?: string;
}

// --- Activities
export interface Activity {
    _id?: string;
    context?: object;
    data?: any;
    message?: string;
    type?: string;
    from?: string;
    modified?: Date;
}

// --- Automations (event-driven graph)

/**
 * A CRON schedule as `node-cron` parses it (`'00 07 * * *'`), shared by the
 * automation CRON trigger and anything else that needs an expression.
 */
export interface TimeTrigger {
    expression: string;
}

/** How a trigger node wakes its branch up. */
export type AutomationTriggerType =
    | 'CRON' // a `node-cron` expression (see `TimeTrigger`)
    | 'DEVICE_STATE' // a device attribute transitions
    | 'EVENT' // another action completed (chaining)
    | 'VISION' // a live-camera event (vision-feed)
    | 'MANUAL'; // run from the UI / REST

export type AutomationNodeKind = 'trigger' | 'action' | 'notify' | 'condition';

/**
 * Which devices/attributes can be watched. `attribute` is either one of the two
 * canonical numbers (`power`, `level`) or a free `properties` key — the same
 * vocabulary the device provider exposes.
 */
export interface DeviceStateTrigger {
    deviceId: string;
    attribute: 'power' | 'level' | string;
    /** Target value: the branch runs when the attribute *enters* it. */
    to?: PropertyValue;
    /** Optional origin value (used with `edge: 'leave'`, or to pin a transition). */
    from?: PropertyValue;
    /** `enter` (default) fires when value == to; `leave` when it leaves from; */
    /** `change` fires on any change of the attribute. */
    edge?: 'enter' | 'leave' | 'change';
    /** Ignore repeated firings within this window (flapping sensors). */
    cooldownMs?: number;
}

/** A live-camera event trigger (`vision-feed` → the automations bus). */
export interface VisionTrigger {
    /** Restrict to one camera (device id). */
    cameraId?: string;
    /** Require one of these vision modes on the event (empty = any). */
    modes?: string[];
    /** Event kind to react to (empty = any). */
    kind?: VisionEventKind;
    /** Require one of these classes to be present (empty = any). */
    classes?: string[];
}

export interface AutomationTrigger {
    type: AutomationTriggerType;
    cron?: TimeTrigger;
    device?: DeviceStateTrigger;
    /** For VISION triggers: which live-camera event wakes the branch. */
    vision?: VisionTrigger;
    /**
     * For EVENT triggers: the completion to listen to. Empty = any action
     * completion. Also accepts `action-completed`, or the precise
     * `action:<automationId>:<nodeId>`.
     */
    event?: string;
    /** Allow this automation to be re-triggered by its own action (default off). */
    allowSelfTrigger?: boolean;
}

/** A gate: the branch continues only when the device attribute matches. */
export interface ConditionDef {
    deviceId: string;
    attribute: 'power' | 'level' | string;
    op: 'eq' | 'neq' | 'gt' | 'lt' | 'between';
    /** Single value, or `[min, max]` for `between`. */
    value?: PropertyValue | PropertyValue[];
}

export interface AutomationNode {
    id: string;
    kind: AutomationNodeKind;
    label?: string;
    /** kind === 'trigger' */
    trigger?: AutomationTrigger;
    /** kind === 'action' — natural language, run through the existing `ask()`. */
    action?: { text: string };
    /** kind === 'notify' — a push notification (no NLU). */
    notify?: { title?: string; body: string };
    /** kind === 'condition' */
    condition?: ConditionDef;
    /** Graph layout; auto-laid out left→right when absent. */
    position?: { x: number; y: number };
}

/** `when` gates whether an edge is followed, from the source node's result. */
export interface AutomationEdge {
    id?: string;
    from: string;
    to: string;
    when?: 'always' | 'success' | 'failure';
}

export interface Automation {
    _id?: string;
    name: string;
    active: boolean;
    nodes: AutomationNode[];
    edges: AutomationEdge[];
    lastRun?: Date;
}

/**
 * One observed `action → state` arc, counted over time (`automation_effects`).
 *
 * Written by the runtime observer (`automations/effects.ts`) when a device-state
 * transition lands inside an action's correlation window. This is how the house
 * graph draws "this action produced that state" without ever guessing it.
 */
export interface AutomationEffect {
    _id: string;
    automationId: string;
    nodeId: string;
    deviceId: string;
    attribute: string;
    value: PropertyValue;
    /** How many times the arc was observed. */
    count: number;
    firstAt: number;
    lastAt: number;
}

// --- Shopping list

/** Aisle of a grocery item: drives the grouping/order of the shopping tab. */
export type GroceryCategory =
    | 'fruits-legumes'
    | 'boulangerie'
    | 'boucherie'
    | 'poissonnerie'
    | 'cremerie'
    | 'epicerie'
    | 'surgeles'
    | 'boissons'
    | 'hygiene'
    | 'entretien'
    | 'autre';

/** `todo` = still to buy, `taken` = in the basket (the tab's "bucket"). */
export type ShoppingItemStatus = 'todo' | 'taken';

export interface ShoppingItem {
    id: string;
    name: string;
    quantity?: number;
    unit?: string;
    category?: GroceryCategory;
    note?: string;
    status: ShoppingItemStatus;
    /** Epoch ms: kept JSON-friendly so the UI can sort without parsing dates. */
    addedAt: number;
    takenAt?: number;
    /** Recognized speaker who asked for the item, if any. */
    user?: string;
}

/**
 * One raw request as spoken/typed by the user, kept verbatim until the
 * background restructurer turns it into items (or the fallback parser does).
 */
export interface ShoppingRawRequest {
    id: string;
    text: string;
    at: number;
    /** `voice` = echo device or browser voice chat (both go through `ask`). */
    source: 'voice' | 'ui' | 'api' | 'llm' | 'camera';
    user?: string;
    processed: boolean;
}

export interface ShoppingProcessing {
    state: 'idle' | 'running' | 'failed';
    lastRunAt?: number;
    error?: string;
}

export interface ShoppingList {
    _id?: string;
    /**
     * Scope of the list. Always `household`: the whole home shares one list
     * (see `skills/shopping/list.ts`), individual requests still record their speaker.
     */
    scopeKey: string;
    status: 'active' | 'archived';
    createdAt: number;
    updatedAt: number;
    archivedAt?: number;
    raw: ShoppingRawRequest[];
    items: ShoppingItem[];
    processing?: ShoppingProcessing;
}

// --- Recipes (cooking)

/**
 * Yield of a recipe: how many people it serves, and what it produces.
 *
 * `0` is the "the source does not say" marker — the same convention the scanned
 * recipe has always used — so a photo and an imported web page fill the same
 * three fields and nothing downstream has to know where the recipe came from.
 */
export interface RecipeEstimatedFor {
    /** 0 when the source does not say. */
    persons: number;
    /** What it yields ("crêpes"), when the source names it. */
    name?: string;
    /** How many items it yields; 0 when the source does not say. */
    quantity: number;
}

export interface RecipeIngredient {
    name: string;
    /** Absent when the source gives no amount. */
    quantity?: number;
    /** Displayed unit ("g", "c. à soupe"), only ever with a quantity. */
    unit?: string;
    /** A precision written next to the ingredient ("pour la cuisson"). */
    note?: string;
}

/** A cooking recipe — the payload of a scan and of an imported page alike. */
export interface Recipe {
    title: string;
    /** Absent when the source gives neither a number of people nor a yield. */
    estimatedFor?: RecipeEstimatedFor;
    /** Seconds, 0 when the source does not say. */
    prepTimeS: number;
    cookTimeS: number;
    ingredients: RecipeIngredient[];
    steps: string[];
}

/** Where a stored recipe came from. */
export type RecipeSource = 'scan' | 'marmiton' | 'manual';

/**
 * Rating of the source (`4.7`, 692 reviews). Kept because it is how the
 * household picks *the best* recipe: the search ranks on it, the tab shows it
 * and the voice says it.
 */
export interface RecipeRating {
    value: number;
    count: number;
}

/**
 * Document of the `recipes` collection: the household's cooking library.
 *
 * `recipe` is nested and identical to what a scanned recipe produces; what
 * surrounds it is provenance. `sourceKey` is the dedupe key (`marmiton:16969`),
 * so importing the same page twice updates the record instead of adding a
 * second one.
 */
export interface RecipeRecord {
    _id: string;
    sourceKey: string;
    source: RecipeSource;
    recipe: Recipe;
    /** French one-liner computed at write time (list rows, voice). */
    summary: string;
    /** Folded title, written at save time so the library searches cheaply. */
    titleFold: string;
    /** Folded ingredient names, same reason. */
    ingredientsFold?: string;
    /** Web sources only. */
    sourceUrl?: string;
    imageUrl?: string;
    description?: string;
    category?: string;
    author?: string;
    keywords?: string[];
    rating?: RecipeRating;
    /** Web sources only: the page's own total time. */
    totalTimeS?: number;
    /** Vision provenance: the scan the recipe was read from, if any. */
    scanId?: string;
    user?: string;
    createdAt: number;
    updatedAt: number;
}

// --- Vision (scanned documents)

/** `pending` while the model works, then `done` or `failed` (retryable). */
export type VisionScanStatus = 'pending' | 'done' | 'failed';

/** Where the image came from: the tab, an API client, a voice flow, a camera. */
export type VisionScanSource = 'ui' | 'api' | 'voice' | 'camera';

/** `forced` = the caller named the type (no classifier call was needed). */
export type VisionTypeSource = 'detected' | 'forced';

/** The image of a scan, stored on disk (metadata only here). */
export interface VisionImageRef {
    /** File name in the vision images directory. */
    file: string;
    mime: string;
    bytes: number;
    /** sha256 of the bytes: the same photo sent twice is recognizable. */
    hash: string;
}

/**
 * One scanned document: the image, the type the vision module resolved and the
 * data extracted with that type's schema. A failed scan keeps its image, so the
 * user can retry or correct the type without photographing the paper again.
 */
export interface VisionScan {
    _id: string;
    status: VisionScanStatus;
    /** Module id once the document type is known (`recipe`, `generic`…). */
    type?: string;
    typeSource?: VisionTypeSource;
    source: VisionScanSource;
    /** Recognized speaker / account that sent the image, if any. */
    user?: string;
    image: VisionImageRef;
    /** Module payload: module-specific (see `vision/modules/*.ts`). */
    data?: any;
    /** Raw model answer, kept for prompt debugging. */
    raw?: string;
    model?: string;
    /** Module summary, for the list rows and the voice. */
    summary?: string;
    error?: string;
    timingMs?: { detect?: number; extract?: number };
    createdAt: number;
    updatedAt: number;
}

// --- Live cameras (vision-feed)

/**
 * A camera's live-analysis config is **not** a type of its own: the mode
 * selection is an ordinary durable device property — `device.properties.visionModes`,
 * a CSV of ids from `cameras/modes.ts`, where no mode means no analysis — written
 * by the `camera` provider (`devices/providers/camera`) and read by
 * `cameras/index.ts`.
 *
 * The frame source is **not** here either: a camera provider row is one camera,
 * so `kind` / `host` / `snapshotUrl` live on the `Provider` (see
 * `cameras/sources.ts#CameraSource`, a parsed view — never a stored struct).
 */

/** What a live vision event is. */
export type VisionEventKind =
    | 'motion'
    | 'enter'
    | 'leave'
    | 'dwell'
    | 'appear'
    | 'disappear'
    | 'gesture';

/** One semantic observation published by `vision-feed`. */
export interface VisionEvent {
    at: number;
    cameraId: string;
    /** The selected modes that watch this event's class(es) — event tagging. */
    modes: string[];
    kind: VisionEventKind;
    /** Detected classes (COCO names) on the track(s). */
    classes: string[];
    trackId?: number;
    score?: number;
    dwellMs?: number;
    keyframeUrl?: string;
    vlm?: { tier: 'fast' | 'heavy'; text: string };
}

