/**
 * this script creates an express server that handles GET requests to /devices and 
 * PUT requests to /devices/:deviceId. /devices gets relayed as a device list request 
 * on the z-way network, and the device specific PUT request relays the request to the z-way server 
 * 
 * Usage: USERNAME=USERNAME PASSWORD=PASSWORD node index.js PORT TV_SERVER_HOST TV_SERVER_PORT
 * 	where PORT is the port to listen on,
 *  USERNAME and PASSWORD are the credentials to use when relaying to the z-way server, 
 *  and TV_SERVER_HOST TV_SERVER_PORT are the host and port are the TV server and port
 */

/**
 * cheap polyfill for Object.assign()
 */
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

/**
 * promise wrapper for http
 */
function httpPromise(options, postData) {
	return new Promise((resolve, reject) => {
		var outRequest = http.request((options, outResponse) => {
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
	});
}
function get(path, options) {
	return httpPromise(assign({ method: 'GET', path: path }, options));
}
function post(path, postData, options) {
	return httpPromise(assign({ method: 'POST', path: path }, options), postData);
}

var express = require('express'),
	bodyParser = require('body-parser'),
	http = require('http');

(function main() {

	/**
	 * Gets a z-way session ID using the USERNAME and PASSWORD
	 */
	function getSession() {
		var fullPath = `${ZWAY}/login`;
		return post(fullPath, JSON.stringify({ login: USERNAME, password: PASSWORD }), getOptions())
			.then(response => JSON.parse(response.responseText).data.sid);
	}

	/**
	 * Returns options for http
	 * 
	 * @param {boolean} includeSid Whether to include the sid 
	 */
	function getOptions(includeSid) {
		return includeSid ? assign({ headers: { ZWAYSession: sid } }, OPTIONS) : OPTIONS;
	}

	/**
	 * Opens a session and uses that session to make a GET request
	 * 
	 * @param {string} path The request path 
	 */
	function authGet(path) {
		return getSession()
			.then(_sid => sid = _sid)
			.then(() => get(path, getOptions(true)));
	}

	/**
	 * Checks if the request is for TV
	 * 
	 * @param {object} request 
	 */
	function isTvRequest(request) {
		return request.params.deviceId === TV.id || request.params.deviceId === TELEVISION.id;
	}

	/**
	 * Attempts to make a GET request using an existing session ID. If the attempt 
	 * fails with a 401 unauthorized, attempts to start a new session and then 
	 * make the same GET request
	 * 
	 * @param {string} path The request path 
	 */
	function zwayGet(path) {
		var fullPath = `${ZWAY}${path}`;
		if (sid) {
			return get(fullPath, getOptions(true))
				.then(response => {
					if (response.statusCode === 401) {
						return authGet(fullPath);
					}
					return response;
				});
		}
		return authGet(fullPath);
	}
	if (process.argv.length < 5) {
		console.log(`Usage: USERNAME=USERNAME PASSWORD=PASSWORD node ${__filename} PORT TV_SERVER_HOST TV_SERVER_PORT`);
		process.exit(-1);
	}
	const PORT = process.argv[2],
		USERNAME = process.env.USERNAME,
		PASSWORD = process.env.PASSWORD,
		TV_SERVER_HOST = process.argv[3],
		TV_SERVER_POST = process.argv[4],
		ZWAY = '/ZAutomation/api/v1',
		OPTIONS = {
			port: 8083
		},
		TV = {
			id: 'tv',
			metrics: {
				title: 'TV',
				level: 'off'
			}
		},
		TELEVISION = {
			id: 'television',
			metrics: {
				title: 'Television',
				level: 'off'
			}
		};

	var server = express(),
		sid;

	server.use(bodyParser.json());
	server.use(bodyParser.urlencoded({ extended: true }));

	/* express get handler */
	server.get('/devices', function (inRequest, inResponse) {
		console.log('GET request for /devices received');

		/* make a request to the z way server */
		zwayGet('/devices')
			.then(response => {
				var devices = JSON.parse(response.responseText).data.devices;
				devices.push(TV);
				devices.push(TELEVISION);
				inResponse.status(200).send(JSON.stringify(devices));
			})
			.catch(error => inResponse.status(500).send(JSON.stringify({ error: error })));
	});

	/* express put handler */
	server.put('/devices/:deviceId', (inRequest, inResponse) => {
		console.log(`PUT request for /devices/${inRequest.params.deviceId} received`);

		var command = (inRequest.body.level === 'on') ? 'on' : 'off';

		if (isTvRequest(inRequest)) {
			post('/', command, { host: TV_SERVER_HOST, port: TV_SERVER_POST })
				.then(response => inResponse.status(200).send(JSON.stringify({ code: 200, message: '200 OK' })))
				.catch(error => inResponse.status(500).send(JSON.stringify({ error: error })));
		} else {
			/* make a request to the z-way server */
			zwayGet(`/devices/${inRequest.params.deviceId}/command/${command}`)
				.then(response => inResponse.status(200).send(JSON.stringify({ code: 200, message: '200 OK' })))
				.catch(error => inResponse.status(500).send(JSON.stringify({ error: error })));
		}
	});

	http.createServer(server).listen(PORT);
	console.log(`Server listening on port ${PORT}`);
})();