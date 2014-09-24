var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');
var auth = require('http-digest-auth');

var realm = 'test realm';
var users = {
	'mylog':  auth.passhash(realm, 'mylog', 'mypass')
};

describe("authenticate event", function suite() {
	it("should be able to continue request and get a 401", function(done) {
		var server = require('http').createServer(function(req, res) {
			var username = auth.login(req, res, realm, users);
			if (username === false) return;
			res.end('<html><body>User: ' + username + '</body></html>');
		}).listen(8007);

		WebKit().load("http://localhost:8007", function(err, view) {
			expect(err).to.be(401);
			setImmediate(function() {
				server.close();
				done();
			});
		});
	});
	it("should be able to authenticate request and get a 200", function(done) {
		var server = require('http').createServer(function(req, res) {
			var username = auth.login(req, res, realm, users);
			if (username === false) return;
			res.end('<html><body>User: ' + username + '</body></html>');
		}).listen(8006);

		WebKit().load("http://localhost:8006", function(err, view) {
			expect(err).to.not.be.ok();
		}).once('authenticate', function(authRequest) {
			expect(authRequest.host).to.be("localhost");
			expect(authRequest.port).to.be(8006);
			expect(authRequest.realm).to.be(realm);
			authRequest.use('mylog', 'mypass');
		}).html(function(err, html) {
			expect(html).to.be("<html><head></head><body>User: mylog</body></html>");
			server.close();
			done();
		});
	});
	it("should be able to explicitely ignore request and get a 401", function(done) {
		var server = require('http').createServer(function(req, res) {
			var username = auth.login(req, res, realm, users);
			if (username === false) return;
			res.end('<html><body>User: ' + username + '</body></html>');
		}).listen(8005);

		var reached = false;

		WebKit().load("http://localhost:8005", function(err, view) {
			expect(err).to.be(401);
			expect(reached).to.be(true);
			setImmediate(function() {
				server.close();
				done();
			});
		}).on('authenticate', function(authReq) {
			reached = true;
			authReq.ignore();
		});
	});
});

