var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');
var pdf = require('pdfinfo');

describe("pdf method", function suite() {
	it("should save a printed pdf to disk", function(done) {
		this.timeout(10000);
		var pdfpath = __dirname + '/shots/test.pdf';
		WebKit().load("https://www.debian.org/", {
			width:800, height:600,
			style: fs.readFileSync(__dirname + "/../css/png.css")
		}, function(err) {
			expect(err).to.not.be.ok();
		}).wait('load').pdf(pdfpath, function(err) {
			expect(err).to.not.be.ok();
			fs.stat(pdfpath, function(err, stat) {
				expect(stat.size).to.be.above(100000);
				done();
			});
		});
	});
	it("should save a full page A4 pdf to disk", function(done) {
		this.timeout(10000);
		var pdfpath = __dirname + '/shots/testa4.pdf';
		WebKit().load("https://www.debian.org/", {
			width:800, height:600,
			style: fs.readFileSync(__dirname + "/../css/png.css")
		}, function(err) {
			expect(err).to.not.be.ok();
		}).wait('load').pdf(pdfpath, {margins: 0, paper:"iso_a3"}, function(err) {
			expect(err).to.not.be.ok();
			pdf(pdfpath).info(function(err, meta) {
				expect(err).to.not.be.ok();
				expect(meta.page_size).to.be('841.89 x 1190.55 pts');
				done();
			});
		});
	});
	it("should save a custom sized with custom margins pdf to disk", function(done) {
		this.timeout(10000);
		var pdfpath = __dirname + '/shots/testcustom.pdf';
		WebKit().load("https://www.debian.org/", {
			width:800, height:600,
			style: fs.readFileSync(__dirname + "/../css/png.css")
		}, function(err) {
			expect(err).to.not.be.ok();
		}).wait('load').pdf(pdfpath, {
			margins: {top: 20, bottom: 20, left:10, right: 10, unit: 'mm'},
			paper: {width: 100, height: 100, unit: 'mm'}
		}, function(err) {
			expect(err).to.not.be.ok();
			pdf(pdfpath).info(function(err, meta) {
				expect(err).to.not.be.ok();
				expect(meta.page_size).to.be('283.465 x 283.465 pts');
				done();
			});
		});
	});
});

