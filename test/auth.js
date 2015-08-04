var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');
var auth = require('http-digest-auth');

var users = {
	mylog1: auth.passhash('one', 'mylog1', 'mypass'),
	mylog2: auth.passhash('two', 'mylog2', 'mypass'),
	mylog3: auth.passhash('three', 'mylog3', 'mypass')
};

describe("authenticate event", function suite() {
	var port, server;
	before(function(done) {
		server = require('http').createServer(function(req, res) {
			var username = auth.login(req, res, req.url.substring(1), users);
			if (username === false) return;
			res.end('<html><body>User: ' + username + '</body></html>');
		}).listen(function() {
			port = server.address().port;
			done();
		});
	});
	after(function(done) {
		server.close();
		done();
	});

	it("should be able to continue request and get a 401", function(done) {
		WebKit(function(err, w) {
			expect(err).to.not.be.ok();
			w.load("http://localhost:" + port + '/one', function(err) {
				expect(err).to.be(401);
				done();
			});
		})
	});

	it("should be able to authenticate request and get a 200", function(done) {
		WebKit(function(err, w) {
			expect(err).to.not.be.ok();
			w.load("http://localhost:" + port + '/two', function(err) {
				expect(err).to.not.be.ok();
			});
			w.on('authenticate', function(authRequest) {
				expect(authRequest.host).to.be("localhost");
				expect(authRequest.port).to.be(port);
				expect(authRequest.realm).to.be('two');
				authRequest.use('mylog2', 'mypass');
			});
			w.on('ready', function() {
				w.html(function(err, html) {
					expect(html).to.be("<html><head></head><body>User: mylog2</body></html>");
					done();
				});
			});
		});
	});

	it("should be able to explicitely ignore request and get a 401", function(done) {
		var reached = false;

		WebKit(function(err, w) {
			w.load("http://localhost:" + port + '/three', function(err) {
				expect(err).to.be(401);
				expect(reached).to.be(true);
				done();
			});
			w.on('authenticate', function(authReq) {
				reached = true;
				authReq.ignore();
			});
		});
	});
});

