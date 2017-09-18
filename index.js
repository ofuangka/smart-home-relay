'use strict';

var result = require('dotenv').config();
if (result.error) {
	throw result.error;
}

const HASS_PREFIX = '/api',
	DEFAULT_HEADERS = {
		Accept: '*/*',
		'Content-Type': 'application/json'
	},
	TV = {
		id: 'tv',
		type: 'television',
		name: 'TV',
		description: "Sharp AQUOS N6000U",
		manufacturer: 'Sharp'
	},
	TELEVISION = Object.assign({}, TV, { id: 'television', name: 'Television' }),
	ROKU = {
		id: 'roku',
		type: 'roku',
		name: 'Roku',
		description: 'Roku Streaming Stick 3600',
		manufacturer: 'Roku'
	},
	TV_KEYS = {
		power: 'KEY_POWER',
		volumeUp: 'KEY_VOLUMEUP',
		volumeDown: 'KEY_VOLUMEDOWN',
		channelUp: 'KEY_CHANNELUP',
		channelDown: 'KEY_CHANNELDOWN',
		mute: 'KEY_MUTE',
		input: 'KEY_SWITCHVIDEOMODE',
		liveTv: 'KEY_TV',
		ok: 'KEY_OK'
	},
	ROKU_KEYS = {
		home: 'Home',
		reverse: 'Rev',
		forward: 'Fwd',
		play: 'Play',
		select: 'Select',
		left: 'Left',
		right: 'Right',
		down: 'Down',
		up: 'Up',
		back: 'Back',
		instantReplay: 'InstantReplay',
		info: 'Info',
		backspace: 'Backspace',
		search: 'Search',
		enter: 'Enter'
	},
	ALEXA_PLAYBACK = {
		FastForward: 'forward',
		Rewind: 'reverse',
		Pause: 'play',
		Play: 'play',
		StartOver: 'home'
	},
	SUPPORTED_RESOURCES = {
		power: 'power',
		channel: 'channel',
		input: 'input',
		volume: 'volume',
		playback: 'playback'
	};

var bodyParser = require('body-parser'),
	http = require('http'),
	parseString = require('xml2js').parseString,
	server = require('express')();

var port = process.env.LISTEN_PORT,
	hassPassword = process.env.HASS_PASSWORD,
	hassHost = process.env.HASS_HOST,
	hassPort = process.env.HASS_PORT,
	irHost = process.env.IR_HOST,
	irPort = process.env.IR_PORT,
	rokuHost = process.env.ROKU_HOST,
	rokuPort = process.env.ROKU_PORT,
	isVerbose = process.env.IS_VERBOSE,
	pauseMs = parseInt(process.env.PAUSE_MS || '375'),
	maxIrRepeat = parseInt(process.env.MAX_IR_REPEAT || '50');

function httpPromise(options, postData) {
	var startMs = Date.now();
	verbose(startMs, options.method, options.path, postData);
	return new Promise((resolve, reject) => {
		var outRequest = http.request(options, outResponse => {
			var data = '';
			outResponse.on('data', chunk => data += chunk);
			outResponse.on('end', () => {
				verbose(startMs, options.path, data, `${Date.now() - startMs}ms`);
				resolve({
					statusCode: outResponse.statusCode,
					headers: outResponse.headers,
					responseText: data
				});
			});
		});
		outRequest.on('error', error => {
			verbose(startMs, options.path, error, `${Date.now() - startMs}ms`);
			reject(error);
		});
		if (postData !== undefined) {
			outRequest.write(postData);
		}
		outRequest.end();
	})
		.then(response => {
			if (response.statusCode === 200) {
				return response;
			}
			throw new Error(`HTTP statusCode ${response.statusCode}`);
		});
}

function xmlParse(s) {
	return new Promise((resolve, reject) => {
		parseString(s, (error, result) => {
			if (error) {
				reject(error);
			} else {
				resolve(result);
			}
		});
	});
}

function get(path, options) {
	return httpPromise(Object.assign({ method: 'GET', path: path }, options));
}

function put(path, options, postData) {
	return httpPromise(Object.assign({ method: 'PUT', path: path }, options), postData);
}

function post(path, options, postData) {
	return httpPromise(Object.assign({ method: 'POST', path: path }, options), postData);
}

function waitFor(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function pause() {
	return waitFor(pauseMs);
}

function handleTvChannelRequest(inRequest, inResponse) {
	var endpointId = getEndpointId(inRequest),
		channel = inRequest.body;

	if (typeof channel.channelCount === 'number') {

		/* just send a success immediately */
		sendSuccess(inResponse, {
			value: channel,
			isoTimestamp: now(),
			uncertaintyMs: 0
		});
		irRepeat(channel.channelCount < 0 ? TV_KEYS.channelDown : TV_KEYS.channelUp, endpointId, Math.abs(channel.channelCount))
			.catch(log);
	} else {

		/* TODO: implement */
		sendUnsupportedDeviceOperationError(inRequest, inResponse);
	}
}

function handleRokuChannelRequest(inRequest, inResponse) {
	var channel = inRequest.body,
		number = channel.number - 1;
	sendSuccess(inResponse, {
		value: channel,
		isoTimestamp: now(),
		uncertaintyMs: 0
	});
	get('/query/apps', getRokuOptions())
		.then(response => xmlParse(response.responseText))
		.then(result => {
			if (result && result.apps) {
				var apps = result.apps.app.filter(app => app.$.type === 'appl');
				if (apps[number]) {
					return post(`/launch/${apps[number].$.id}`, getRokuOptions());
				}
				throw new Error(`Requested channel not available: ${number}`);
			}
		})
		.catch(log);
}

function handleTvInputRequest(inRequest, inResponse) {
	var endpointId = getEndpointId(inRequest),
		input = inRequest.body;

	if (typeof input.name === 'string' && !isNaN(parseInt(input.name))) {
		var inputId = parseInt(input.name);

		/* just send a success immediately */
		sendSuccess(inResponse);
		sendIrCommand(TV_KEYS.liveTv, endpointId)
			.then(pause)
			.then(() => irRepeat(TV_KEYS.input, endpointId, inputId))
			.then(pause)
			.then(() => sendIrCommand(TV_KEYS.ok, endpointId))
			.catch(log);
	} else {

		/* TODO: implement */
		sendUnsupportedDeviceOperationError(inRequest, inResponse);
	}
}

function handleRokuPlaybackRequest(inRequest, inResponse) {
	var directive = inRequest.body.directive;
	if (ALEXA_PLAYBACK.hasOwnProperty(directive)) {
		post(`/keypress/${ROKU_KEYS[ALEXA_PLAYBACK[directive]]}`, getRokuOptions())
			.then(rokuResponse => sendSuccess(inResponse, rokuResponse))
			.catch(error => sendError(inResponse, error));
	} else {
		sendUnsupportedDeviceOperationError(inRequest, inResponse);
	}
}

function log() {
	console.log.apply(console, Array.prototype.map.call(arguments, argument => typeof argument === 'object' ? JSON.stringify(argument) : argument));
}

function verbose() {
	if (isVerbose) {
		log.apply(null, arguments);
	}
}

function getIrOptions(postData) {
	return getOptions(irHost, irPort, postData);
}

function getRokuOptions(postData) {
	return getOptions(rokuHost, rokuPort, postData);
}

function getHassOptions(postData) {
	return getOptions(hassHost, hassPort, postData, {
		'x-ha-access': hassPassword
	});
}

function getOptions(hostname, port, postData, overrideHeaders) {
	var headers = Object.assign({
		'Content-Length': typeof postData === 'string' ? Buffer.byteLength(postData) : 0
	}, DEFAULT_HEADERS, overrideHeaders);
	var ret = { headers: headers };
	if (hostname && hostname !== 'localhost') {
		ret.hostname = hostname;
	}
	ret.port = port;
	return ret;
}

/**
 * Checks if the request is for TV
 * 
 * @param {object} inRequest 
 */
function isTvRequest(inRequest) {
	var endpointId = getEndpointId(inRequest);
	return [TV.id, TELEVISION.id].indexOf(endpointId) !== -1;
}

function isRokuRequest(inRequest) {
	return getEndpointId(inRequest) === ROKU.id;
}

function handleTvPowerRequest(inRequest, inResponse) {
	var endpointId = getEndpointId(inRequest),
		powerState = inRequest.body.state;

	sendIrCommand(TV_KEYS.power, endpointId)
		.then(() =>
			sendSuccess(inResponse, {
				state: powerState,
				isoTimestamp: now(),
				uncertaintyMs: 0
			})
		)
		.catch(error => sendError(inResponse, error));
}

function sendIrCommand(key, endpointId) {

	/* TODO: don't hardcode the receiverId */
	var irPath = `/receivers/Sharp/commands`,
		postData = JSON.stringify({ key: key });
	return post(irPath, getIrOptions(postData), postData);
}

function irRepeat(key, endpointId, times) {
	if (times === 0) {
		return Promise.resolve();
	} else if (times === 1) {
		return sendIrCommand(key, endpointId);
	} else if (times > MAX_IR_REPEAT) {

		/* trying to prevent dos */
		return irRepeat(key, endpointId, MAX_IR_REPEAT);
	} else {
		return sendIrCommand(key, endpointId)
			.then(pause)
			.then(() => irRepeat(key, endpointId, times - 1));
	}
}

function handleTvVolumeRequest(inRequest, inResponse) {
	var volumeSteps = inRequest.body.volumeSteps,
		mute = inRequest.body.mute,
		endpointId = getEndpointId(inRequest);

	/* no way to determine status, just return a success */
	sendSuccess(inResponse);

	if (typeof mute === 'boolean') {
		sendIrCommand(TV_KEYS.mute, endpointId)
			.catch(log);
	} else if (volumeSteps) {
		var key = volumeSteps < 0 ? TV_KEYS.volumeDown : TV_KEYS.volumeUp;
		irRepeat(key, endpointId, Math.abs(volumeSteps + 1))
			.catch(log);
	} else {
		log('Invalid request');
	}
}

function sendError(response, error) {
	var sendData = JSON.stringify({ error: typeof error === 'string' ? new Error(error) : error });
	verbose('REPLY 500', sendData);
	response.status(500).send(sendData);
}

function sendSuccess(response, payload) {
	var sendData = JSON.stringify(payload === undefined ? { code: 200, message: '200 OK' } : payload);
	verbose('REPLY 200', sendData);
	response.status(200).send(sendData);
}

function getEndpointId(inRequest) {
	return inRequest.params.endpointId;
}

function logInRequest(inRequest) {
	verbose('RECV', inRequest.body);
	log(inRequest.method, inRequest.path);
}

function getRequestResource(inRequest) {
	return inRequest.path.substr(inRequest.path.lastIndexOf('/'));
}

function sendUnsupportedDeviceOperationError(inRequest, inResponse) {
	sendError(inResponse, `Endpoint ${getEndpointId(inRequest)} does not support ${getRequestResource(inRequest)}`);
}

function now() {
	return new Date().toISOString();
}

function isPowerRequest(inRequest) {
	return getRequestResource(inRequest) === SUPPORTED_RESOURCES.power;
}

function getRequestResource(inRequest) {
	return inRequest.params.resourceId;
}

function handleTvRequest(inRequest, inResponse) {
	var resource = getRequestResource(inRequest);
	switch (resource) {
		case SUPPORTED_RESOURCES.power:
			handleTvPowerRequest(inRequest, inResponse);
			break;
		case SUPPORTED_RESOURCES.channel:
			handleTvChannelRequest(inRequest, inResponse);
			break;
		case SUPPORTED_RESOURCES.volume:
			handleTvVolumeRequest(inRequest, inResponse);
			break;
		case SUPPORTED_RESOURCES.input:
			handleTvInputRequest(inRequest, inResponse);
			break;
		default:
			sendUnsupportedDeviceOperationError(inRequest, inResponse);
			break;
	}
}

function handleRokuRequest(inRequest, inResponse) {
	var resource = getRequestResource(inRequest);
	switch (resource) {
		case SUPPORTED_RESOURCES.channel:
			handleRokuChannelRequest(inRequest, inResponse);
			break;
		case SUPPORTED_RESOURCES.playback:
			handleRokuPlaybackRequest(inRequest, inResponse);
			break;
		default:
			sendUnsupportedDeviceOperationError(inRequest, inResponse);
			break;
	}
}

function isStateZwitch(state) {
	return state.entity_id
		&& (state.entity_id.startsWith('switch.') || state.entity_id.startsWith('light.'))
		&& state.attributes
		&& state.attributes.friendly_name
}

server.use(bodyParser.json());
server.use(bodyParser.urlencoded({ extended: true }));

/* express get handler */
server.get('/endpoints', (inRequest, inResponse) => {
	logInRequest(inRequest);

	/* static endpoints */
	var endpoints = [
		TV,
		TELEVISION,
		ROKU
	];

	get(`${HASS_PREFIX}/states`, getHassOptions())
		.then(response => JSON.parse(response.responseText))
		.then(states =>
			states
				.filter(isStateZwitch)
				.forEach(zwitch => endpoints.push({
					id: zwitch.entity_id,
					type: 'zwitch',
					name: zwitch.attributes.friendly_name,
					description: zwitch.attributes.friendly_name,
					manufacturer: zwitch.attributes.friendly_name
				}))
		)
		.catch(log)
		.then(() => sendSuccess(inResponse, endpoints));
});

/* express put handler */
server.put('/endpoints/:endpointId/:resourceId', (inRequest, inResponse) => {
	logInRequest(inRequest);
	if (isTvRequest(inRequest)) {
		handleTvRequest(inRequest, inResponse);
	} else if (isRokuRequest(inRequest)) {
		handleRokuRequest(inRequest, inResponse);
	} else if (isPowerRequest(inRequest)) {

		/* make a request to the hass server */
		var state = inRequest.body.state,
			service = state === 'on' ? 'turn_on' : 'turn_off',
			endpointId = getEndpointId(inRequest),
			domain = endpointId.substr(0, endpointId.indexOf('.')),
			postData = JSON.stringify({ entity_id: endpointId });
		post(`${HASS_PREFIX}/services/${domain}/${service}`, getHassOptions(postData), postData)
			.then(response => JSON.parse(response.responseText))
			.then(hassResponse => {
				sendSuccess(inResponse, {
					state: state,
					isoTimestamp: now(),
					uncertaintyMs: 0
				});
			})
			.catch(error => {
				log(error);
				sendError(inResponse, error);
			});
	} else {
		sendUnsupportedDeviceOperationError(inRequest, inResponse);
	}
});

http.createServer(server).listen(port);
log(`Server listening on port ${port}`);