'use strict';

const fastify = require('fastify')({
    logger: true
});
const { io } = require('socket.io-client');

// Cloud backend connection
const CLOUD_URL = process.env.CLOUD_URL || 'http://localhost:3000';
let socket;

// Initialize WebSocket connection to cloud
const initCloudConnection = () => {
    socket = io(CLOUD_URL, {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
        fastify.log.info(`Connected to cloud backend: ${socket.id}`);
    });

    socket.on('disconnect', (reason) => {
        fastify.log.warn(`Disconnected from cloud: ${reason}`);
    });

    // Handle PING from cloud server
    socket.on('events.server.PING', (payload) => {
        fastify.log.info('Ping Received');

        // Respond with PONG
        socket.emit('events.client.PONG', {
            timestamp: Date.now(),
            received: payload.timestamp
        });
        fastify.log.info('Sent PONG response');
    });

    socket.on('connect_error', (error) => {
        fastify.log.error(`Cloud connection error: ${error.message}`);
    });
};

// Health check endpoint
fastify.get('/health', async (request, reply) => {
    return {
        status: 'ok',
        venue_node: true,
        cloud_connected: socket?.connected || false
    };
});

// Custom error handler
fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);

    const statusCode = error.statusCode || 500;
    reply.status(statusCode).send({
        error: true,
        message: error.message || 'Internal Server Error',
        statusCode
    });
});

// 404 handler
fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
        error: true,
        message: 'Route not found',
        statusCode: 404
    });
});

// Start server
const start = async () => {
    try {
        await fastify.listen({ port: 8080, host: '0.0.0.0' });

        // Initialize cloud connection after server starts
        initCloudConnection();
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();

