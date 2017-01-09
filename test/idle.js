var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("idle event", function suite() {
	it("should chain lots of promises on client while doing xhr and idle after end of promises", function(done) {
		var hasXHR = false;
		var server = require('http').createServer(function(req, res) {
			if (req.url == "/xhr") {
				res.statusCode = 200;
				hasXHR = true;
				res.setHeader('Content-Type', 'application/json');
				setTimeout(function() {
					res.end(JSON.stringify({
						test: 'xhr'
					}));
				}, 100);
			} else {
				res.statusCode = 404;
				res.end("Not Found");
			}
		}).listen(function() {
			WebKit.load("http://localhost:" + server.address().port, {
				console: true,
				content: `<!DOCTYPE html>
				<html><head><script type="text/javascript">
				function getJson(url, cb) {
					var xhr = new XMLHttpRequest();
					xhr.open("GET", url, true);
					xhr.setRequestHeader("Accept", "application/json; q=1.0");

					xhr.onreadystatechange = function() {
						if (this.readyState != this.DONE) return;
						cb(null, JSON.parse(this.response));
					};
					xhr.send();
				}
				getJson('/xhr', function(err, data) {
					document.querySelector('#xhr').innerHTML = data.test;
				});
				var n = 100;
				var p = Promise.resolve();
				for (var i=0; i < n; i++) {
					p = p.then(function() {
						var d = document.createElement("p");
						d.innerHTML = "toto";
						document.body.appendChild(d);
					});
				}
				p.then(function() {
					document.querySelector('#xhr').innerHTML += i;
				});
				</script></head><body>
					<div id="xhr"></div>
				</body></html>`
			}, function(err) {
				expect(err).to.be(null);
			})
			.once('idle', function() {
				expect(hasXHR).to.be.ok();
				this.html().then(function(str) {
					expect(str.indexOf('<div id="xhr">xhr100</div>')).to.be.greaterThan(0);
				}).then(done).catch(done);
			});
		});
	});
	it("should wait xhr requests called in chain, even with a zero timeout delay", function(done) {
		this.timeout(5000);
		var hasXHR1 = false;
		var hasXHR2 = false;
		var server = require('http').createServer(function(req, res) {
			if (req.url == "/xhr1") {
				res.statusCode = 200;
				hasXHR1 = true;
				res.setHeader('Content-Type', 'application/json');
				setTimeout(function() {
					res.end(JSON.stringify({
						test: 'xhr1'
					}));
				}, 100);
			} else if (req.url == "/xhr2") {
				res.statusCode = 200;
				hasXHR2 = true;
				res.setHeader('Content-Type', 'application/json');
				setTimeout(function() {
					res.end(JSON.stringify({
						test: 'xhr2'
					}));
				}, 100);
			} else {
				res.statusCode = 404;
				res.end("Not Found");
			}
		}).listen(function() {
			WebKit.load("http://localhost:" + server.address().port, {
				console: true,
				content: `<!DOCTYPE html>
				<html><head><script type="text/javascript">
				function getJson(url, cb) {
					var xhr = new XMLHttpRequest();
					xhr.open("GET", url, true);
					xhr.setRequestHeader("Accept", "application/json; q=1.0");

					xhr.onreadystatechange = function() {
						if (this.readyState != this.DONE) return;
						cb(null, JSON.parse(this.response));
					};
					xhr.send();
				}
				getJson('/xhr1', function(err, data) {
					document.querySelector('#xhr1').innerHTML = data.test;
					setTimeout(function() {
						getJson('/xhr2', function(err, data) {
							document.querySelector('#xhr2').innerHTML = data.test;
						});
					}, 0);
				});
				</script></head><body>
					<div id="xhr1"></div>
					<div id="xhr2"></div>
				</body></html>`
			}, function(err) {
				expect(err).to.be(null);
			})
			.once('idle', function() {
				this.run(function(done) {
					done(null,
						document.querySelector('#xhr1').innerHTML,
						document.querySelector('#xhr2').innerHTML
					);
				}, function(err, xhr1, xhr2) {
					expect(xhr1).to.be('xhr1');
					expect(xhr2).to.be('xhr2');
					server.close();
					done();
				});
				expect(hasXHR1).to.be.ok();
				expect(hasXHR2).to.be.ok();
			});
		});
	});

	it("should wait xhr requests called in chain, even with promises", function(done) {
		this.timeout(5000);
		var hasXHR1 = false;
		var hasXHR2 = false;
		var server = require('http').createServer(function(req, res) {
			if (req.url == "/xhr1") {
				res.statusCode = 200;
				hasXHR1 = true;
				res.setHeader('Content-Type', 'application/json');
				setTimeout(function() {
					res.end(JSON.stringify({
						test: 'xhr1'
					}));
				}, 100);
			} else if (req.url == "/xhr2") {
				res.statusCode = 200;
				hasXHR2 = true;
				res.setHeader('Content-Type', 'application/json');
				setTimeout(function() {
					res.end(JSON.stringify({
						test: 'xhr2'
					}));
				}, 100);
			} else {
				res.statusCode = 404;
				res.end("Not Found");
			}
		}).listen(function() {
			WebKit.load("http://localhost:" + server.address().port, {
				console: true,
				content: `<!DOCTYPE html>
				<html><head><script type="text/javascript">
				function getJson(url) {
					var resolve, reject;
					var p = new Promise(function(f, r) {
						resolve = f;
						reject = r;
					});
					var xhr = new XMLHttpRequest();
					xhr.open("GET", url, true);
					xhr.setRequestHeader("Accept", "application/json; q=1.0");

					xhr.onreadystatechange = function() {
						if (this.readyState != this.DONE) return;
						resolve(JSON.parse(this.response));
					};
					xhr.send();
					return p;
				}
				Promise.resolve().then(function() {
					return Promise.all([getJson('/xhr1'), getJson('/xhr2')]).then(function(datas) {
						document.querySelector('#xhr1').innerHTML = datas[0].test;
						document.querySelector('#xhr2').innerHTML = datas[1].test;
						return Promise.resolve("end");
					});
				}).then(function(end) {
					document.querySelector('#end').innerHTML = end;
				});
				</script></head><body>
					<div id="xhr1"></div>
					<div id="xhr2"></div>
					<div id="end"></div>
				</body></html>`
			}, function(err) {
				expect(err).to.be(null);
			})
			.once('idle', function() {
				this.run(function(done) {
					done(null,
						document.querySelector('#xhr1').innerHTML,
						document.querySelector('#xhr2').innerHTML,
						document.querySelector('#end').innerHTML
					);
				}, function(err, xhr1, xhr2, end) {
					expect(xhr1).to.be('xhr1');
					expect(xhr2).to.be('xhr2');
					expect(end).to.be('end');
					server.close();
					done();
				});
				expect(hasXHR1).to.be.ok();
				expect(hasXHR2).to.be.ok();
			});
		});
	});

});
