import _ from 'lodash/fp';
import jsonPatch from 'fast-json-patch';
import Sert from 'sert-schema';

let EntityREST = {};

/**
 * Make express middleware for an endpoint
 * @param {function} endpointFunction Endpoint function (getting standard endpoint params)
 * @param {object} spec Specifications for endpoint
 * @param {array} args Additional arguments for endpoint function
 * @return {function} Express middleware
 */
EntityREST.express = (endpointFunction, spec = {}, ...args) => {
    return async (req, res, next) => {
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
            // Authenticate
            if (spec.authenticate) {
                try {
                    spec.authenticate(request, ...args);
                } catch (e) {
                    if (e.status) {
                        throw e;
                    }

                    // When authentication failed, respond with 401
                    const err = new Error(e.message);
                    err.details = e.details;
                    err.status = 401;
                    throw err;
                }
            }

            // Validation of request
            if (spec.validate) {
                try {
                    spec.validate(request, ...args);
                } catch (e) {
                    if (e.status) {
                        throw e;
                    }

                    // If validation failed, respond with 400
                    const err = new Error(e.message);
                    err.details = e.details;
                    err.status = 400;
                    throw err;
                }
            }

            await endpointFunction(request, respond, spec, ...args);

            next();

        } catch (error) {
            next(error);
        }
    };
};

EntityREST.exportHAL = _.curry((url, Entity, data) => {
    if (Array.isArray(data)) {
        return {
            _links: {
                self: { href: `${url}${url.slice(-1) !== '/' ? '/' : ''}${Entity.pluralName || 'data'}/` }
            },
            count: data.length,
            _embedded: {
                // [Entity.pluralName]: data.map(Entity.exportHAL || _.identity)
                [Entity.pluralName || 'data']: data
            }
        };
    } else {
        // return (Entity.exportHAL || _.identity)(data);
        return {
            ...data,
            _links: {
                self: { href: `${url}/${Entity.pluralName}/${data.id}` }
            }
        };
    }
});

/**
 * Get db query conditions based on request query
 * @param {object} query Request query
 * @return {object} Database query
 */
function filterConditions(query) {
    if (query.q) {
        // Database query encoded in url query
        return JSON.parse(query.q);
    }

    return (Object.keys(query)).reduce((conditions, prop) => {
        if (prop === 'limit' || prop === 'offset' || prop === 'sort' || prop === 'q') {
            return conditions;
        }

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
 * @param {object} spec Custom endpoint specifications
 * @param {object} Entity Entity function container
 */
EntityREST.getOne = async (request, respond, spec = {}, Entity) => {
    Sert.string(request.urlParams.entityId, { status: 400, message: 'Entity id is required.' });

    const entity = await Entity.findById(request.urlParams.entityId);

    const exportEntity = await (Entity.exportOne || _.identity)(entity);

    respond(200, exportEntity);
};

/**
 * Get many entities
 * @param {object} request Request data
 * @param {function} respond Respond function, takes arguments (status, data)
 * @param {object} spec Custom endpoint specifications
 * @param {object} Entity Entity function container
 */
EntityREST.getMany = async (request, respond, spec = {}, Entity) => {
    // Limit
    const limit = Math.min(parseInt(request.query.limit || 25), 500);

    // Sort
    const sortMatch = request.query.sort && (request.query.sort || '').match(/^(-?)(.*)$/);
    const sort = sortMatch ? { [sortMatch[2]]: (sortMatch[1] === '-' ? -1 : 1) } : { _id: 1 };

    // Skip
    const skip = parseInt(request.query.offset) || 0;

    const entities = await Entity.find({
        ...filterConditions(request.query),
        ...(spec.query || _.stubObject)(request)
    }, { limit, skip, sort });

    // const exportEntities = await Entity.exportMany(entities);

    // const exportEntities = await Promise.all(
    //     entities.map(async entity => await (Entity.exportOne || _.identity)(entity))
    // );

    const exportEntities = Entity.exportMany ?
        await Entity.exportMany(entities)
        :
        await Promise.all(
            entities.map(async entity => await (Entity.exportOne || _.identity)(entity))
        );

    respond(200, exportEntities);
};

/**
 * Post one entity
 * @param {object} request Request data
 * @param {function} respond Respond function, takes arguments (status, data)
 * @param {object} spec Custom endpoint specifications
 * @param {object} Entity Entity function container
 */
EntityREST.postOne = async (request, respond, spec = {}, Entity) => {
    const setProps = await (spec.set || _.stubObject)(request);
    const createProps = _.omitBy(_.isUndefined,
        (Entity.prepareCreate || _.identity)({
            ...request.body,
            ...setProps,
            _embedded: undefined,
            _links: undefined
        })
    );

    // Entity.assertValidPartial(createProps, { status: 400, message: 'Invalid entity properties.' });
    Entity.assertValid({
        id: '123456789012345678901234', // Fake post-create id
        ...createProps
    }, { status: 400, message: 'Invalid entity properties.' });

    Entity.shouldCreate && await Entity.shouldCreate(createProps, request);

    const entity = await Entity.createOne(createProps);
    const exportEntity = await (Entity.exportOne || _.identity)(entity);

    respond(201, exportEntity);

    Entity.didCreate && Entity.didCreate(entity);
};

/**
 * Put one entity
 * @param {object} request Request data
 * @param {function} respond Respond function, takes arguments (status, data)
 * @param {object} spec Custom endpoint specifications
 * @param {object} Entity Entity function container
 */
EntityREST.putOne = async (request, respond, spec = {}, Entity) => {
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
        (Entity.prepareUpdate || _.identity)({
            // ...existingEntity,
            // ...updateProps,
            ...Entity.resetReadOnly(request.body, existingEntity),
            ...setProps,
            id: request.urlParams.entityId,
            _embedded: undefined,
            _links: undefined
        })
    );

    Entity.assertValid(replaceProps, { status: 400, message: 'Invalid entity properties.' });

    Entity.shouldUpdate && await Entity.shouldUpdate(replaceProps, request);

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
 * @param {object} spec Custom endpoint specifications
 * @param {object} Entity Entity function container
 */
EntityREST.patchOne = async (request, respond, spec = {}, Entity) => {
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
                _embedded: undefined,
                _links: undefined
            })
        );

        Entity.assertValid(updateProps, { status: 400, message: 'Invalid entity properties.' });

        Entity.shouldUpdate && await Entity.shouldUpdate(updateProps, request);

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
                _embedded: undefined,
                _links: undefined
            })
        );

        Entity.assertValid(updateProps, { status: 400, message: 'Invalid entity properties.' });

        Entity.shouldUpdate && await Entity.shouldUpdate(updateProps, request);

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
 * @param {object} spec Custom endpoint specification
 * @param {object} Entity Entity function container
 */
EntityREST.patchMany = async (request, respond, spec = {}, Entity) => {
    const existingEntities = await Entity.find({
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
                _embedded: undefined,
                _links: undefined
            })
        );

        Entity.assertValid(updateProps, { status: 400, message: 'Invalid entity properties.' });
        Entity.shouldUpdate && await Entity.shouldUpdate(updateProps, request);

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
 * @param {object} spec Custom endpoint specification
 * @param {object} Entity Entity function container
 */
EntityREST.deleteOne = async (request, respond, spec = {}, Entity) => {
    const entity = await Entity.findById(request.urlParams.entityId);
    Sert.object(entity, { status: 404, message: 'Resource not found.' });

    Entity.shouldDelete && await Entity.shouldDelete(entity, request);

    await Entity.deleteOne(entity);

    respond(200, {});

    Entity.didDelete && Entity.didDelete(entity);
};

export default EntityREST;
