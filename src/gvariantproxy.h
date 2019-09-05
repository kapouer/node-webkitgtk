#ifndef WEBKITGTK_GVARIANTPROXY_H
#define WEBKITGTK_GVARIANTPROXY_H

#include <node.h>
#include <nan.h>
#include "utils.h"

class GVariantProxy : public node::ObjectWrap {
public:
	static Nan::Persistent<v8::FunctionTemplate> constructor;
	static void Init(v8::Local<v8::Object>);
	static NAN_METHOD(New);

	GVariantDict* dict = NULL;
	GVariant* variant = NULL;

	GVariantProxy();
	void init(GVariant*);

private:
	~GVariantProxy();
};

#endif
