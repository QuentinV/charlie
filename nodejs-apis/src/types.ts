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
export interface Tool<P> {
    description?: string;
    inputSchema?: any;
    exec: (params?: P) => Promise<string | void | boolean>;
    disabled?: boolean;
    instance?: any;
}

export type Tools = { [name: string]: Tool<any> };

// --- Devices, Room, providers
export interface Device {
    _id?: string;
    name: string;
    externalId: string;
    provider: string;
    type: string;
    state?: DeviceState;
}

export const DeviceTypes = {
    light: 'light',
    switch: 'switch',
    shutter: 'shutter',
    sprinkler: 'sprinkler',
    tv: 'tv',
    unknown: 'unknown',
};

export interface Room {
    _id: string;
    name: string;
    internalId: string;
    devices?: string[];
}

export interface Provider {
    _id?: string;
    name: string;
    codesource: string;
    host?: string;
    user?: string;
    password?: string;
    multidevices?: boolean;
}

export type PowerType = 'on' | 'off' | 'pause';

export interface DeviceState {
    power: PowerType;
    level?: number;
    additional?: object;
}

export interface ProviderFunction {
    name: string;
    params?: object;
}

export interface ProviderFunctionDef extends ProviderFunction {
    returns?: object;
}

export interface ProviderApiMetaInfo {
    device: Device;
    provider: Provider;
}

export interface ProviderApi {
    init?: (provider: Provider) => Promise<boolean>;
    discover?: (provider: Provider) => Promise<object[]>;
    changeDeviceState: (
        meta: ProviderApiMetaInfo,
        params: DeviceState
    ) => Promise<DeviceState | boolean>;
    getDeviceState?: (meta: ProviderApiMetaInfo) => Promise<DeviceState>;
    getFunctions?: (
        meta: ProviderApiMetaInfo
    ) => Promise<ProviderFunctionDef[]>;
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

// --- Activities
export interface Activity {
    _id?: string;
    context?: object;
    data?: any;
    message?: string;
    type?: string;
    from?: string;
}
