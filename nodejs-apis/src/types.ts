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

export interface RestApiHandlerParams {
    query: any;
    body: any;
    params: any;
    headers: { [key: string]: string };
}

export type RestApiHandler = (
    params: RestApiHandlerParams
) => Promise<void | undefined | object>;

export type RestApiFullHandler = (
    params: RestApiHandlerParams,
    res: any
) => Promise<void>;

export type RestApis = { [route: string]: RestApi };

// --- Tools
/** Runtime context passed to a tool executor (recognized user / session). */
export interface ToolExecutionContext {
    user?: string;
    sessionId?: string;
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
