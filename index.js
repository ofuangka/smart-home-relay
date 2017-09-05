/**
 * this script creates an express server that handles GET requests to /endpoints and 
 * PUT requests to /endpoints/:endpointId/:resource. /endpoints gets relayed as a device list request 
 * on the z-way network, and the device specific PUT request relays the request to the z-way server 
 */

const HASS_PREFIX = '/api',
	DEFAULT_HEADERS = {
		accept: '*/*',
		'Content-Type': 'application/json'
	},
	TV = {
		id: 'tv',
		type: 'television',
		name: 'TV',
		description: "Sharp AQUOS N6000U",
		manufacturer: 'Sharp'
	},
	TELEVISION = {
		id: 'television',
		type: 'television',
		name: 'Television',
		description: "Sharp AQUOS N6000U",
		manufacturer: 'Sharp'
	},
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
		warmUp: 'KEY_RED',
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
	PAUSE_MS = 1000,
	MAX_IR_REPEAT = 50,
	SUPPORTED_RESOURCES = {
		power: 'power',
		channel: 'channel',
		input: 'input',
		volume: 'volume',
		playback: 'playback'
	};

var express = require('express'),
	bodyParser = require('body-parser'),
	http = require('http'),
	https = require('https'),
	dotenv = require('dotenv'),
	parseString = require('xml2js').parseString,
	fs = require('fs'),
	server = express();

dotenv.load();

var port = process.env.LISTEN_PORT,
	hassPassword = process.env.HASS_PASSWORD,
	hassHost = process.env.HASS_HOST,
	hassPort = process.env.HASS_PORT,
	irHost = process.env.IR_HOST,
	irPort = process.env.IR_PORT,
	rokuHost = process.env.ROKU_HOST,
	rokuPort = process.env.ROKU_PORT,
	isVerbose = process.env.IS_VERBOSE,
	httpsHassOptions = {
		ca: fs.readFileSync(process.env.CA_PATH),
	},
	sid;

	httpsHassOptions.agent = new https.Agent(httpHassOptions);

function assign(target) {
	for (var i = 1; i < arguments.length; i++) {
		var source = arguments[i];
		for (var nextKey in source) {
			if (source.hasOwnProperty(nextKey)) {
				target[nextKey] = source[nextKey];
			}
		}
	}
	return target;
}

function httpPromise(options, isSecure, postData) {
	return new Promise((resolve, reject) => {
		var outRequest = (isSecure ? https : http).request(options, outResponse => {
			var data = '';
			outResponse.on('data', chunk => data += chunk);
			outResponse.on('end', () => {
				resolve({
					statusCode: outResponse.statusCode,
					headers: outResponse.headers,
					responseText: data
				});
			});
		});
		outRequest.on('error', error => reject(error));
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

function get(path, options, isSecure) {
	verbose('GET', path);
	return httpPromise(assign({ method: 'GET', path: path }, options), isSecure);
}

function put(path, options, isSecure, postData) {
	verbose('PUT', path, postData);
	return httpPromise(assign({ method: 'PUT', path: path }, options), isSecure, postData);
}

function post(path, options, isSecure, postData) {
	verbose('POST', path, postData);
	return httpPromise(assign({ method: 'POST', path: path }, options), isSecure, postData);
}

function waitFor(ms) {
	return new Promise((resolve, reject) => setTimeout(resolve, ms));
}

function pause() {
	return waitFor(PAUSE_MS);
}

function handleTvChannelRequest(inRequest, inResponse) {
	var endpointId = getEndpointId(inRequest),
		channel = inRequest.body;

	verbose('channel', channel);

	if (typeof channel.channelCount === 'number') {

		/* just send a success immediately */
		sendSuccess(inResponse, {
			value: channel,
			isoTimestamp: now(),
			uncertaintyMs: 0
		});
		sendIrCommand(TV_KEYS.warmUp, endpointId)
			.then(irRepeat(channel.channelCount < 0 ? TV_KEYS.channelDown : TV_KEYS.channelUp, endpointId, Math.abs(channel.channelCount)))
			.then(result => log('channelSuccess', result))
			.catch(error => log('channelFailure', error));
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
		.catch(error => sendError(inResponse, error));
}

function handleTvInputRequest(inRequest, inResponse) {
	var endpointId = getEndpointId(inRequest),
		input = inRequest.body;

	log('input:', input);

	if (typeof input.name === 'string' && !isNaN(parseInt(input.name))) {
		var inputId = parseInt(input.name);

		/* just send a success immediately */
		sendSuccess(inResponse);
		sendIrCommand(TV_KEYS.warmUp, endpointId)
			.then(result => sendIrCommand(TV_KEYS.liveTv, endpointId))
			.then(pause)
			.then(() => irRepeat(TV_KEYS.input, endpointId, inputId))
			.then(pause)
			.then(() => sendIrCommand(TV_KEYS.ok, endpointId))
			.then(result => log('inputSuccess', result))
			.catch(error => log('inputError', error));
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
	return assign(getOptions(hassHost, hassPort, postData, {
		'x-ha-access': hassPassword
	}), httpsHassOptions);
}

function getOptions(hostname, port, postData, overrideHeaders) {
	var headers = assign({
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
		powerState = inRequest.body.state,
		key = TV_KEYS.power;

	sendIrCommand(TV_KEYS.warmUp, endpointId)
		.then(() => sendIrCommand(key, endpointId))
		.then(irResponse =>
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
	var irPath = `/receivers/Sharp/command`,
		postData = JSON.stringify({ key: key });
	return put(irPath, getIrOptions(postData), postData);
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
		sendIrCommand(TV_KEYS.warmUp, endpointId)
			.then(() => sendIrCommand(TV_KEYS.mute, endpointId));
	} else if (volumeSteps) {
		var key = volumeSteps < 0 ? TV_KEYS.volumeDown : TV_KEYS.volumeUp;
		sendIrCommand(TV_KEYS.warmUp, endpointId)
			.then(() => irRepeat(key, endpointId, Math.abs(volumeSteps)));
	} else {
		sendError(inResponse, 'Invalid request');
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

function logRequest(inRequest) {
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

function isStateValid(state) {
	return state.entity_id
		&& state.entity_id.startsWith('switch.')
		&& state.attributes
		&& state.attributes.friendly_name
}

server.use(bodyParser.json());
server.use(bodyParser.urlencoded({ extended: true }));

/* express get handler */
server.get('/endpoints', (inRequest, inResponse) => {
	logRequest(inRequest);

	/* static endpoints */
	var endpoints = [
		TV,
		TELEVISION,
		ROKU
	];

	get(`${HASS_PREFIX}/states`, getHassOptions(), true)
		.then(response => JSON.parse(response.responseText))
		.then(states => {
			verbose('states:', states);
			return states.filter(isStateValid);
		})
		.then(binarySwitches => {
			verbose('binarySwitches:', binarySwitches);
			binarySwitches.forEach(binarySwitch => endpoints.push({
				id: binarySwitch.entity_id,
				type: 'switchBinary',
				name: binarySwitch.attributes.friendly_name,
				description: binarySwitch.attributes.friendly_name,
				manufacturer: binarySwitch.attributes.friendly_name
			}));
		})
		.catch(log)
		.then(() => {
			sendSuccess(inResponse, endpoints);
		});
});

/* express put handler */
server.put('/endpoints/:endpointId/:resourceId', (inRequest, inResponse) => {
	logRequest(inRequest);
	if (isTvRequest(inRequest)) {
		handleTvRequest(inRequest, inResponse);
	} else if (isRokuRequest(inRequest)) {
		handleRokuRequest(inRequest, inResponse);
	} else if (isPowerRequest(inRequest)) {

		/* make a request to the z-way server */
		var service = inRequest.body.state === 'on' ? 'turn_on' : 'turn_off',
			endpointId = getEndpointId(inRequest),
			postData = JSON.stringify({ entity_id: endpointId });
		post(`${HASS_PREFIX}/services/switch/${service}`, getHassOptions(postData), true, postData)
			.then(response => JSON.parse(response.responseText))
			.then(hassResponse => {
				verbose('hassResponse:', hassResponse);
				sendSuccess(inResponse, {
					state: inRequest.body.state,
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
console.log(`Server listening on port ${port}`);