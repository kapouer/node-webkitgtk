const WebKit = require('../');
const expect = require('expect.js');
const auth = require('http-digest-auth');

const users = {
	mylog1: auth.passhash('one', 'mylog1', 'mypass'),
	mylog2: auth.passhash('two', 'mylog2', 'mypass'),
	mylog3: auth.passhash('three', 'mylog3', 'mypass')
};

describe("authenticate event", () => {
	let port, server;
	before((done) => {
		server = require('http').createServer((req, res) => {
			const username = auth.login(req, res, req.url.substring(1), users);
			if (username === false) return;
			res.end('<html><body>User: ' + username + '</body></html>');
		}).listen(() => {
			port = server.address().port;
			done();
		});
	});
	after((done) => {
		server.close();
		done();
	});

	it("should be able to continue request and get a 401", (done) => {
		WebKit.load("http://localhost:" + port + '/one', (err) => {
			expect(err).to.be(401);
			done();
		});
	});

	it("should be able to authenticate request and get a 200", (done) => {
		WebKit.load("http://localhost:" + port + '/two', (err) => {
			expect(err).to.not.be.ok();
		})
			.on('authenticate', (authRequest) => {
				expect(authRequest.host).to.be("localhost");
				expect(authRequest.port).to.be(port);
				expect(authRequest.realm).to.be('two');
				authRequest.use('mylog2', 'mypass');
			})
			.once('ready', function() {
				this.html((err, html) => {
					expect(html).to.be("<html><head></head><body>User: mylog2</body></html>");
					done();
				});
			});
	});

	it("should be able to explicitely ignore request and get a 401", (done) => {
		let reached = false;

		WebKit.load("http://localhost:" + port + '/three', (err) => {
			expect(err).to.be(401);
			expect(reached).to.be(true);
			done();
		}).on('authenticate', (authReq) => {
			reached = true;
			authReq.ignore();
		});
	});
});

