/**
 * this script creates an express server that handles GET requests to /devices and 
 * PUT requests to /devices/:deviceId. /devices gets relayed as a device list request 
 * on the z-way network, and the device specific PUT request relays the request to the z-way server 
 * 
 * Usage: USERNAME=USERNAME PASSWORD=PASSWORD node index.js PORT
 * 	where PORT is the port to listen on,
 *  USERNAME and PASSWORD are the credentials to use when relaying to the z-way server
 */
if (process.argv.length < 3) {
	console.log('Usage: USERNAME=USERNAME PASSWORD=PASSWORD node ' + __filename + ' PORT');
	process.exit(-1);
}

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
	return new Promise(function (resolve, reject) {
		var outRequest = http.request(options, function (outResponse) {
			var data = '';
			outResponse.on('data', function (chunk) {
				data += chunk;
			});
			outResponse.on('end', function () {
				resolve({
					headers: outResponse.headers,
					responseText: data
				});
			});
		});
		outRequest.on('error', function (error) {
			reject(error);
		});
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
/**
 * authenticated get()
 */
function authGet(path) {

	/* this makes a post request with credentials to get an authenticated session before the get request */
	return post(ZWAY + '/login', JSON.stringify({ login: USERNAME, password: PASSWORD }), OPTIONS).then(function (response) {
		var sid = JSON.parse(response.responseText).data.sid;
		return get(ZWAY + path, assign({ headers: { ZWAYSession: sid } }, OPTIONS));
	});
}
var express = require('express')
	bodyParser = require('body-parser'),
	http = require('http'),
	Promise = require('promise');

const OPTIONS = {
	port: 8083
},
	PORT = process.argv[2],
	USERNAME = process.env.USERNAME,
	PASSWORD = process.env.PASSWORD,
	ZWAY = '/ZAutomation/api/v1';

var server = express();
server.use(bodyParser.json());
server.use(bodyParser.urlencoded({ extended: true }));

/* express get handler */
server.get('/devices', function (inRequest, inResponse) {
	console.log('GET request for /devices received');

	/* make a request to the z way server */
	authGet('/devices').then(function (response) {
		var devices = JSON.parse(response.responseText).data.devices;
		inResponse.send(JSON.stringify(devices));
	}).catch(function (error) {
		inResponse.send(JSON.stringify({ error: error }));
	});
});

/* express put handler */
server.put('/devices/:deviceId', function (inRequest, inResponse) {
	console.log('PUT request for /devices/' + inRequest.params.deviceId + ' received');

	var command = (inRequest.body.level === 'on') ? 'on' : 'off';

	/* make a request to the z-way server */
	authGet('/devices/' + inRequest.params.deviceId + '/command/' + command).then(function (response) {
		inResponse.send(JSON.stringify({ code: 200, message: '200 OK' }));
	}).catch(function (error) {
		inResponse.send(JSON.stringify({ error: error }));
	});
});

http.createServer(server).listen(PORT);
console.log('Server listening on port ' + PORT);
