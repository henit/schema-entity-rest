import _ from 'lodash/fp';
import jsonPatch from 'fast-json-patch';
import Sert from 'sert-schema';

let EntityREST = {};

/*
- authenticate (request, respond)
    - respond - stop process
    - throw error - respond 401, stop process
- validate (request, respond)
    - respond - stop proess
    - throw error - respond 400, stop process
- endpoint function (request, respond)

- query (request, Entity)
- set (request, Entity)

- shouldCreate
- ‎prepareCreate (add default props)
- ‎didCreate

app.get('/path/', Endpoints.express(EntityEndpoints.getOne, { query }, Memo));
*/

/**
 * Make express middleware for an endpoint
 * @param {function} endpointFunction Endpoint function (getting standard endpoint params)
 * @param {object} spec Specifications for endpoint
 * @param {array} args Additional arguments for endpoint function
 * @return {function} Express middleware
 */
EntityREST.express = (endpointFunction, spec, ...args) => {
    return async (req, res, next) => {
        console.log('EXPRESS MIDDLEWARE');

        const request = {
            urlParams: req.params || {},
            query: req.query || {},
            body: req.body || {},
            user: req.user
        };
        const respond = (status = 200, data = {}) => {
            if ((typeof data) === 'object') {
                res
                    .status(status)
                    .set('Content-Type', 'application/hal+json')
                    .json(data);
            } else {
                res
                    .status(status)
                    .send(data || '');
            }
        };

        try {
            if (spec.authenticate) {
                spec.authenticate(request, ...args);
            }

            if (spec.validate) {
                spec.validate(request, ...args);
            }

            await endpointFunction(request, respond, ...args);

            next();

        } catch (error) {
            next(error);
        }
    };
};

/**
 * Make express middleware for an endpoint function
 * @param {function} endpoint Endpoint function
 * @return {function} Express middleware for endpoint
 */
/*MEMEndpoints.express = (endpoint, ...args) => {
    return async (req, res, next) => {
        console.log('EXPRESS MIDDLEWARE');

        const request = {
            urlParams: req.params || {},
            query: req.query || {},
            body: req.body || {},
            user: req.user
        };
        const respond = (status = 200, data = {}) => {
            if ((typeof data) === 'object') {
                res
                    .status(status)
                    .set('Content-Type', 'application/hal+json')
                    .json(data);
            } else {
                res
                    .status(status)
                    .send(data || '');
            }
            next();
        };

        try {
            await endpoint(request, respond, ...args);
        } catch (e) {
            next(e);
        }
    };
};*/

/**
 * Run entity endpoint function (argument wrapper)
 * @param {object} router The express app/router
 * @param {string} method HTTTP method for endpoint
 * @param {string} path Relative API path
 * @param {object} TypeEntity Function container for entity type
 * @param {object} spec Custom specifications for this endpoint
 * @param {function} func Function with endpoint logic
 */
/*SUREntityEndpoints.express = (router, method, path, TypeEntity, access, spec, func) =>
    Endpoints.express(router, method, path, access, async request => {
        if (spec && spec.validate) {
            spec.validate(request);
        }
        await func(request, TypeEntity, spec);
    });*/

/**
 * Export entity data (object or collection) to HAL structure
 * @param {object} TypeEntity Function container for the entity type
 * @param {object|array} data Entity/entities
 * @return {object} HAL data
 */
/*SUREntityEndpoints.exportHAL = (TypeEntity, data) => {
    if (Array.isArray(data)) {
        return {
            _links: {
                self: { href: `${config.server.publicUrl}/${TypeEntity.pluralName}` }
            },
            count: data.length,
            _embedded: {
                [TypeEntity.pluralName]: data.map(TypeEntity.exportHAL || _.identity)
            }
        };
    } else {
        return (TypeEntity.exportHAL || _.identity)(data);
    }
};*/



/**
 * Get db query conditions based on request query
 * @param {object} query Request query
 * @return {object} Database query
 */
function filterConditions(query) {
    return (Object.keys(query)).reduce((conditions, prop) => {
        if (query[prop] !== undefined) {
            // Special case rule
            if (query[prop] === 'undefined') {
                return {
                    ...conditions,
                    [prop]: { $exists: false }
                };
            } else if (query[prop] === 'true') {
                return {
                    ...conditions,
                    [prop]: true
                };
            } else if (query[prop] === 'false') {
                return {
                    ...conditions,
                    [prop]: false
                };
            }

            // Convert to RegExp for partial match searches
            const regexpSyntax = query[prop].match(/^\/(.*)\/(g|i|m|u|y)*$/);

            if (regexpSyntax) {
                // Condition value is regexp
                return {
                    ...conditions,
                    // [prop]: new RegExp(regexpSyntax[1], regexpSyntax[2])
                    [prop]: { $in: [new RegExp(regexpSyntax[1], regexpSyntax[2])] }
                };
            }

            // Normal condition, direct value comparison
            return {
                ...conditions,
                [prop]: query[prop]
            };
        }
        return conditions;
    }, {});
}





/**
 * Get one entity
 * @param {object} request Request data
 * @param {function} respond Respond function, takes arguments (status, data)
 * @param {object} Entity Entity function container
 * @param {object} spec Custom endpoint specifications
 */
EntityREST.getOne = async (request, respond, Entity, spec = {}) => {
    Sert.string(request.urlParams.entityId, { status: 400, message: 'Entity id is required.' });

    const entity = await Entity.findById(request.urlParams.entityId);
    const exportEntity = await Entity.exportOne(entity);

    respond(200, exportEntity);
};

/**
 * Get many entities
 * @param {object} request Request data
 * @param {function} respond Respond function, takes arguments (status, data)
 * @param {object} Entity Entity function container
 * @param {object} spec Custom endpoint specifications
 */
EntityREST.getMany = async (request, respond, Entity, spec = {}) => {
    // Limit
    const limit = Math.min(parseInt(request.query.limit || 25), 500);

    // Sort
    const sortMatch = request.query.sort && (request.query.sort || '').match(/^(\-?)(.*)$/);
    const sort = sortMatch ? { [sortMatch[2]]: (sortMatch[1] === '-' ? -1 : 1) } : { _id: 1 };

    // Skip
    const skip = parseInt(request.query.offset) || 0;

    const entities = await Entity.find({
        // ...EntityEndpoints.filterConditions(Entity, request.query),
        ...filterConditions(request.query),
        ...(spec.query || _.stubObject)(request)
    }, { limit, skip, sort });
    const exportEntities = await Entity.exportMany(entities);

    respond(200, exportEntities);
};

/**
 * Post one entity
 * @param {object} request Request data
 * @param {function} respond Respond function, takes arguments (status, data)
 * @param {object} Entity Entity function container
 * @param {object} spec Custom endpoint specifications
 */
EntityREST.postOne = async (request, respond, Entity, spec = {}) => {
    const setProps = await (spec.set || _.stubObject)(request);
    const createProps = _.omitBy(_.isUndefined,
        (Entity.prepareCreate || _.identity)({
            ...request.body,
            ...setProps,
            _embedded: undefined
        })
    );

    // Entity.assertValidPartial(createProps, { status: 400, message: 'Invalid entity properties.' });
    Entity.assertValid(createProps, { status: 400, message: 'Invalid entity properties.' });

    Entity.shouldCreate && await Entity.shouldCreate(createProps);

    const entity = await Entity.createOne(createProps);
    const exportEntity = await (Entity.exportOne || _.identity)(entity);

    respond(201, exportEntity);

    Entity.didCreate && Entity.didCreate(entity);
};

/**
 * Put one entity
 * @param {object} request Request data
 * @param {function} respond Respond function, takes arguments (status, data)
 * @param {object} Entity Entity function container
 * @param {object} spec Custom endpoint specifications
 */
EntityREST.putOne = async (request, respond, Entity, spec = {}) => {
    // Validate input
    // Entity.assertValid(request.body, {
    //     message: 'Invalid entity properties',
    //     status: 400
    // });


    const existingEntity = await Entity.findById(request.urlParams.entityId);
    Sert.object(existingEntity, { status: 404, message: 'Resource not found.' });

    // const updateProps = Object.keys(Entity.schema.properties).reduce((patchProps, prop) =>
    //     Entity.schema.properties[prop].readOnly ? immutable.del(patchProps, prop) : patchProps
    // , request.body);

    const setProps = await (spec.set || _.stubObject)(request);
    const replaceProps = _.omitBy(_.isUndefined,
        (Entity.prepareCreate || _.identity)({
            // ...existingEntity,
            // ...updateProps,
            ...Entity.resetReadOnly(request.body, existingEntity),
            ...setProps,
            id: request.urlParams.entityId,
            _embedded: undefined
        })
    );

    Entity.assertValid(replaceProps, { status: 400, message: 'Invalid entity properties.' });

    Entity.shouldUpdate && await Entity.shouldUpdate(replaceProps);

    const entity = await Entity.replaceOne(replaceProps);
    const exportEntity = await (Entity.exportOne || _.identity)(entity);

    respond(200, exportEntity);

    Entity.didUpdate && Entity.didUpdate(exportEntity);
};

/*function patchUpdateProps(TypeEntity, body) {
    Sert.notEmpty(body, { status: 400, message: 'Empty update' });

    // Validate input
    TypeEntity.assertValidPartial(body, {
        message: 'Invalid entity properties',
        status: 400
    });

    // Omit all readOnly props
    return Object.keys(TypeEntity.schema.properties).reduce((patchProps, prop) =>
        TypeEntity.schema.properties[prop].readOnly ? immutable.del(patchProps, prop) : patchProps
    , body);
}*/

/**
 * Patch one entity
 * @param {object} request Request data
 * @param {function} respond Respond function, takes arguments (status, data)
 * @param {object} Entity Entity function container
 * @param {object} spec Custom endpoint specifications
 */
EntityREST.patchOne = async (request, respond, Entity, spec = {}) => {
    const existingEntity = await Entity.findById(request.urlParams.entityId);
    Sert.object(existingEntity, { status: 404, message: 'Resource not found.' });

    if (Array.isArray(request.body)) {
        // JSON-Patch
        // const existingEntity = await Entity.findById(request.urlParams.entityId);
        // Sert.object(existingEntity, { status: 404, message: 'Resource not found.' });

        const patchErrors = jsonPatch.validate(request.body, existingEntity);

        if (patchErrors && patchErrors > 0) {
            throw new Error('Invalid patch');
        }

        const patchedEntity = jsonPatch.applyPatch(existingEntity, request.body).newDocument;

        const setProps = await (spec.set || _.stubObject)(request);
        const updateProps = _.omitBy(_.isUndefined,
            (Entity.prepareUpdate || _.identity)({
                ...Entity.resetReadOnly(patchedEntity, existingEntity),
                ...setProps,
                id: request.urlParams.entityId,
                _embedded: undefined
            })
        );

        Entity.assertValid(updateProps, { status: 400, message: 'Invalid entity properties.' });

        Entity.shouldUpdate && await Entity.shouldUpdate(updateProps);

        const entity = await Entity.updateOne(updateProps);
        const exportEntity = await (Entity.exportOne || _.identity)(entity);

        respond(200, exportEntity);

        Entity.didUpdate && Entity.didUpdate(exportEntity);

    } else {
        const setProps = await (spec.set || _.stubObject)(request);
        const updateProps = _.omitBy(_.isUndefined,
            (Entity.prepareUpdate || _.identity)({
                // ...patchUpdateProps(Entity, request.body),
                ...Entity.resetReadOnly(request.body, existingEntity),
                ...setProps,
                id: request.urlParams.entityId,
                _embedded: undefined
            })
        );

        Entity.assertValid(updateProps, { status: 400, message: 'Invalid entity properties.' });

        Entity.shouldUpdate && await Entity.shouldUpdate(updateProps);

        const entity = await Entity.updateOne(updateProps);
        const exportEntity = await (Entity.exportOne || _.identity)(entity);

        respond(200, exportEntity);

        Entity.didUpdate && Entity.didUpdate(exportEntity);
    }
};

/**
 * Patch many entities
 * @param {object} request Request data
 * @param {function} respond Respond function, takes arguments (status, data)
 * @param {object} Entity Entity function container
 * @param {object} spec Custom endpoint specification
 */
EntityREST.patchMany = async (request, respond, Entity, spec = {}) => {
    const existingEntities = await Entity.find({
        // ...EntityEndpoints.filterConditions(Entity, request.query),
        ...filterConditions(request.query),
        ...(spec.query || _.stubObject)(request)
    });
    if (!existingEntities) {
        respond(200);
        return;
    }

    const setProps = await (spec.set || _.stubObject)(request);
    const exportEntities = await Promise.all(existingEntities.map(async existingEntity => {
        const updateProps = _.omitBy(_.isUndefined,
            (Entity.prepareUpdate || _.identity)({
                // ...patchUpdateProps(Entity, request.body),
                ...Entity.resetReadOnly(request.body, existingEntity),
                ...setProps,
                id: existingEntity.id,
                _embedded: undefined
            })
        );

        Entity.assertValid(updateProps, { status: 400, message: 'Invalid entity properties.' });
        Entity.shouldUpdate && await Entity.shouldUpdate(updateProps);

        const entity = await Entity.updateOne(updateProps);
        return await (Entity.exportOne || _.identity)(entity);
    }));

    respond(200, exportEntities);

    Entity.didUpdate && exportEntities.map(Entity.didUpdate);
};

/**
 * Delete one entity
 * @param {object} request Request data
 * @param {function} respond Respond function, takes arguments (status, data)
 * @param {object} Entity Entity function container
 * @param {object} spec Custom endpoint specification
 */
EntityREST.deleteOne = async (request, respond, Entity, spec = {}) => {
    const entity = await Entity.findById(request.urlParams.entityId);
    Sert.object(entity, { status: 404, message: 'Resource not found.' });

    Entity.shouldDelete && await Entity.shouldDelete(entity);

    await Entity.deleteOne(entity);

    respond(200, {});

    Entity.didDelete && Entity.didDelete(entity);
};

export default EntityREST;
