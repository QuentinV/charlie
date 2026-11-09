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
    type: 'boolean' | 'number' | 'range' | 'enum' | 'string';
    /** Allowed values for `enum` properties. */
    options?: { value: string; label: string }[];
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
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

// --- Routines
export interface TimeTrigger {
    expression: string;
}

export type TriggerType = TimeTrigger;
export enum TriggerKind {
    CRON = 'CRON',
}

export interface Routine {
    _id?: string;
    name: string;
    triggers: { type: TriggerKind; obj: TriggerType }[];
    actions: string[];
    active: boolean;
}

// --- Automations (event-driven graph, coexists with routines)

/** How a trigger node wakes its branch up. */
export type AutomationTriggerType =
    | 'CRON' // reuse Routine's TimeTrigger { expression }
    | 'DEVICE_STATE' // a device attribute transitions
    | 'EVENT' // another action completed (chaining)
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

export interface AutomationTrigger {
    type: AutomationTriggerType;
    cron?: TimeTrigger;
    device?: DeviceStateTrigger;
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
    source: 'voice' | 'ui' | 'api' | 'llm';
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
     * (see `shopping/list.ts`), individual requests still record their speaker.
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
