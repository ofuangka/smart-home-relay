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
	},
	TV_INPUTS = {
		'ANTENNA': 0,
		'HDMI 1': 2,
		'HDMI 2': 3,
		'HDMI 3': 4,
		'HDMI 4': 5,
		'COMPOSITE': 6,
		'COMPONENT': 7
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

function httpPromise(options, postString) {
	var startMs = Date.now();
	verbose('REQ', options.method, options.path, postString);
	options.headers['Content-Length'] = typeof postString === 'string' ? Buffer.byteLength(postString) : 0;
	return new Promise((resolve, reject) => {
		var request = http.request(options, response => {
			var data = '';
			response.on('data', chunk => data += chunk);
			response.on('end', () => {
				if (response.statusCode === 200) {
					verbose('RESP', options.path, data, `${Date.now() - startMs}ms`);
					if (options.headers['Accept'] === 'application/xml') {
						resolve(xmlParse(data));
					} else if (options.headers['Accept'] === 'application/json') {
						resolve(JSON.parse(data));
					} else {
						resolve(data);
					}
				} else {
					log('HTTP', response.statusCode, options.path, data, `${Date.now() - startMs}ms`);
					reject(new Error(`HTTP ${response.statusCode}`));
				}
			});
		});
		request.on('error', error => {
			log('ERR', options.path, error, `${Date.now() - startMs}ms`);
			reject(error);
		});
		if (typeof postString === 'string') {
			request.write(postString);
		}
		request.end();
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

function post(path, options, postString) {
	return httpPromise(Object.assign({ method: 'POST', path: path }, options), postString);
}

function waitFor(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function pause() {
	return waitFor(pauseMs);
}

function handleTvChannelRequest(inRequest, inResponse) {
	var endpointId = getEndpointId(inRequest),
		delta = inRequest.body.delta;

	if (typeof delta === 'number') {

		/* just send a success immediately */
		sendSuccess(inResponse, {
			state: 0,
			isoTimestamp: now(),
			uncertaintyMs: 0
		});
		irRepeat(delta < 0 ? TV_KEYS.channelDown : TV_KEYS.channelUp, endpointId, Math.abs(delta))
			.catch(log);
	} else {
		sendUnsupportedDeviceOperationError(inRequest, inResponse);
	}
}

function handleRokuChannelRequest(inRequest, inResponse) {
	var channel = parseInt(inRequest.body.number || 0);
	if (!isNaN(channel)) {
		if (channel > 0) {
			sendSuccess(inResponse, {
				state: channel,
				isoTimestamp: now(),
				uncertaintyMs: 0
			});
			get('/query/apps', getRokuOptions())
				.then(result => {
					log(result);
					result.apps.app.filter(app => app.$.type === 'appl')
				})
				.then(apps => post(`/launch/${apps[(channel - 1) % apps.length].$.id}`, getRokuOptions()))
				.then(verbose)
				.catch(log);
		} else {
			sendUnsupportedDeviceOperationError(inRequest, inResponse);
		}
	} else {
		sendUnsupportedDeviceOperationError(inRequest, inResponse);
	}
}

function handleTvInputRequest(inRequest, inResponse) {
	var endpointId = getEndpointId(inRequest),
		input = inRequest.body.input;

	if (TV_INPUTS.hasOwnProperty(input)) {
		sendSuccess(inResponse, {
			state: input,
			isoTimestamp: now(),
			uncertaintyMs: 0
		});
		sendIrCommand(TV_KEYS.liveTv, endpointId)
			.then(pause)
			.then(() => irRepeat(TV_KEYS.input, endpointId, TV_INPUTS[input]))
			.then(() => sendIrCommand(TV_KEYS.ok, endpointId))
			.catch(log);
	} else {
		sendUnsupportedDeviceOperationError(inRequest, inResponse);
	}
}

function handleRokuPlaybackRequest(inRequest, inResponse) {
	var directive = inRequest.body.directive;
	if (ALEXA_PLAYBACK.hasOwnProperty(directive)) {
		sendSuccess(inResponse);
		post(`/keypress/${ROKU_KEYS[ALEXA_PLAYBACK[directive]]}`, getRokuOptions())
			.then(log)
			.catch(log);
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

function getIrOptions() {
	var ret = getOptions(irHost, irPort);
	ret.headers['Accept'] = 'application/json';
	return ret;
}

function getRokuOptions() {
	var ret = getOptions(rokuHost, rokuPort);
	ret.headers['Accept'] = 'application/xml';
	return ret;
}

function getHassOptions() {
	var ret = getOptions(hassHost, hassPort);
	ret.headers['Accept'] = 'application/json';
	ret.headers['x-ha-access'] = hassPassword;
	return ret;
}

function getOptions(hostname, port) {
	var ret = {
		headers: Object.assign({}, DEFAULT_HEADERS),
		port: port
	};
	if (hostname && hostname !== 'localhost') {
		ret.hostname = hostname;
	}
	return ret;
}

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

	sendSuccess(inResponse, {
		state: powerState,
		isoTimestamp: now(),
		uncertaintyMs: 0
	});

	sendIrCommand(TV_KEYS.power, endpointId)
		.catch(log);
}

function sendIrCommand(key, endpointId) {

	/* TODO: don't hardcode the receiverId */
	var irPath = `/receivers/Sharp/commands`,
		postString = JSON.stringify({ key: key });
	return post(irPath, getIrOptions(postString), postString);
}

function irRepeat(key, endpointId, times) {
	if (times === 0) {
		return Promise.resolve();
	} else if (times === 1) {
		return sendIrCommand(key, endpointId);
	} else if (times > maxIrRepeat) {

		/* trying to prevent dos */
		return irRepeat(key, endpointId, maxIrRepeat);
	} else {
		return sendIrCommand(key, endpointId)
			.then(() => irRepeat(key, endpointId, times - 1));
	}
}

function handleTvVolumeRequest(inRequest, inResponse) {
	var endpointId = getEndpointId(inRequest),
		delta = inRequest.body.delta,
		mute = inRequest.body.mute;

	sendSuccess(inResponse);

	if (typeof mute === 'boolean') {
		sendIrCommand(TV_KEYS.mute, endpointId)
			.catch(log);
	} else if (delta) {
		var key = delta < 0 ? TV_KEYS.volumeDown : TV_KEYS.volumeUp;
		irRepeat(key, endpointId, Math.abs(delta) + 1)
			.catch(log);
	} else {
		log('Invalid request');
	}
}

function sendError(inResponse, error) {
	var sendString = JSON.stringify(error || { message: 'Failure' });
	log('REPLY 500', sendString);
	inResponse.status(500).send(sendString);
}

function sendSuccess(inResponse, payload) {
	var sendString = JSON.stringify(payload || { message: 'Success' });
	verbose('REPLY 200', sendString);
	inResponse.status(200).send(sendString);
}

function getEndpointId(inRequest) {
	return inRequest.params.endpointId;
}

function logInRequest(inRequest) {
	log(inRequest.method, inRequest.path, inRequest.body);
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

server.post('/endpoints/:endpointId/:resourceId', (inRequest, inResponse) => {
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
			postString = JSON.stringify({ entity_id: endpointId });
		post(`${HASS_PREFIX}/services/${domain}/${service}`, getHassOptions(postString), postString)
			.then(result => {
				verbose(result);
				sendSuccess(inResponse, {
					state: state,
					isoTimestamp: now(),
					uncertaintyMs: 0
				});
			})
			.catch(error => {
				sendError(inResponse, error);
			});
	} else {
		sendUnsupportedDeviceOperationError(inRequest, inResponse);
	}
});

http.createServer(server).listen(port);
log(`Server listening on port ${port}`);