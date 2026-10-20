export class HttpError extends Error {
    httpStatus: number;

    constructor(httpStatus: number, message?: string) {
        super(message);
        this.name = 'HttpError';
        this.httpStatus = httpStatus;
    }
}

export class UnauthorizedError extends HttpError {
    constructor(message?: string) {
        super(401, message);
        this.name = 'UnauthorizedError';
    }
}

export class ForbiddenError extends HttpError {
    constructor(message?: string) {
        super(403, message);
        this.name = 'ForbiddenError';
    }
}

export class NotFoundError extends HttpError {
    constructor(message?: string) {
        super(404, message);
        this.name = 'NotFoundError';
    }
}

export class NotAcceptableError extends HttpError {
    constructor(message?: string) {
        super(406, message);
        this.name = 'NotAcceptableError';
    }
}
