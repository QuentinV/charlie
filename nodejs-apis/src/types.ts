// ---- Rest apis
export interface RestApi {
    get?: RestApiHandler | RestEndpointDescriptor;
    post?: RestApiHandler | RestEndpointDescriptor;
    delete?: RestApiHandler | RestEndpointDescriptor;
    put?: RestApiHandler | RestEndpointDescriptor;
}

export interface RestEndpointDescriptor {
    handler: RestApiHandler;
    description?: string;
}

export interface RestApiHandlerParams {
    query: any;
    body: any;
    params: any;
}

export type RestApiHandler = (
    params?: RestApiHandlerParams
) => Promise<void | undefined | object>;

export type RestApis = { [route: string]: RestApi };

// --- Tools
export interface Tool<P> {
    description: string;
    inputSchema?: any;
    exec: (params?: P) => Promise<string | void>;
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
    password?: string;
    multidevices?: boolean;
}

export interface DeviceState {
    power: 'on' | 'off' | 'pause';
    level?: number;
}

export interface ProviderInitParams {
    host?: string;
    password?: string;
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
    init?: (params: ProviderInitParams) => Promise<boolean>;
    discover?: () => Promise<object[]>;
    changeDeviceState: (
        meta: ProviderApiMetaInfo,
        params: DeviceState
    ) => Promise<boolean>;
    getDeviceState: (meta: ProviderApiMetaInfo) => Promise<DeviceState>;
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
