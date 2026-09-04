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
export interface ToolExecutor<P> {
    exec: (params?: P) => Promise<string | void | boolean>;
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

export interface ProviderFunctionDef extends ProviderFunction {
    returns?: object;
    inputSchema?: any;
    description?: string;
}

export interface DeviceCapabilities {
    stateSchema?: any;
    functions?: ProviderFunctionDef[];
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
}

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
