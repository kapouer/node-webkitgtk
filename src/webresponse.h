#ifndef WEBKITGTK_WEBRESPONSE_H
#define WEBKITGTK_WEBRESPONSE_H

#include <node.h>
#include <webkit2/webkit2.h>
#include <nan.h>
#include "utils.h"

class WebResponse : public node::ObjectWrap {
public:
	static Nan::Persistent<v8::FunctionTemplate> constructor;
	static void Init(v8::Local<v8::Object>);
	static NAN_METHOD(New);
	static void DataFinished(GObject*, GAsyncResult*, gpointer);

	WebKitURIResponse* response = NULL;
	WebKitWebResource* resource = NULL;

	WebResponse();
	void init(WebKitWebResource*, WebKitURIResponse*);

private:
	~WebResponse();
	Nan::Callback* dataCallback = NULL;

	static NAN_GETTER(get_prop);
	// static NAN_SETTER(set_prop);

	static NAN_METHOD(Data);
};

#endif
