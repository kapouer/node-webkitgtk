const WebKit = require('../');
const expect = require('expect.js');
const fs = require('fs');
const pdf = require('pdfinfo');

describe("pdf method", () => {
	it("should save a printed pdf to disk", function(done) {
		this.timeout(10000);
		const pdfpath = __dirname + '/shots/test.pdf';
		WebKit((err, w) => {
			w.load("https://www.debian.org/", {
				width:800, height:600,
				style: fs.readFileSync(__dirname + "/../css/png.css")
			}, (err) => {
				expect(err).to.not.be.ok();
			}).once('idle', function() {
				this.pdf(pdfpath, (err) => {
					expect(err).to.not.be.ok();
					fs.stat(pdfpath, (err, stat) => {
						expect(stat.size).to.be.above(70000);
						done();
					});
				});
			});
		});
	});

	it("should save a full page A4 pdf to disk", function(done) {
		this.timeout(10000);
		const pdfpath = __dirname + '/shots/testa4.pdf';
		WebKit((err, w) => {
			w.load("https://www.debian.org/", {
				width:800, height:600,
				style: fs.readFileSync(__dirname + "/../css/png.css")
			}, (err) => {
				expect(err).to.not.be.ok();
			}).once('load', function() {
				this.pdf(pdfpath, {margins: 0, paper:"iso_a3"}, (err) => {
					expect(err).to.not.be.ok();
					pdf(pdfpath).info((err, meta) => {
						expect(err).to.not.be.ok();
						expect(meta.page_size).to.be('841.89 x 1190.55 pts (A3)');
						done();
					});
				});
			});
		});
	});

	it("should save a custom sized with custom margins pdf to disk", function(done) {
		this.timeout(10000);
		const pdfpath = __dirname + '/shots/testcustom.pdf';
		WebKit((err, w) => {
			w.load("https://www.debian.org/", {
				width:800, height:600,
				style: fs.readFileSync(__dirname + "/../css/png.css")
			}, (err) => {
				expect(err).to.not.be.ok();
			}).once('load', function() {
				this.pdf(pdfpath, {
					margins: {top: 20, bottom: 20, left:10, right: 10, unit: 'mm'},
					paper: {width: 100, height: 100, unit: 'mm'}
				}, (err) => {
					expect(err).to.not.be.ok();
					pdf(pdfpath).info((err, meta) => {
						expect(err).to.not.be.ok();
						expect(meta.page_size).to.be('283.465 x 283.465 pts');
						done();
					});
				});
			});
		});
	});
});

