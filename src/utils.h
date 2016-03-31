#ifndef WEBKITGTK_UTILS_H
#define WEBKITGTK_UTILS_H

#define ATTR(t, name, get, set) Nan::SetAccessor(t->InstanceTemplate(), Nan::New(name).ToLocalChecked(), get, set);
#define TOSTR(obj) (*String::Utf8Value((obj)->ToString()))
#define H(name) Nan::New<String>(name).ToLocalChecked()

#include <nan.h>
#include <glib.h>
#include <soup.h>

Nan::Utf8String* getOptStr(v8::Handle<v8::Object>, const gchar*);
Nan::Callback* getCb(v8::Handle<v8::Object>, const gchar*);
void update_soup_headers_with_dict(SoupMessageHeaders*, GVariant*);
GVariant* soup_headers_to_gvariant_dict(SoupMessageHeaders*);

// Method removed from NAN
NAN_INLINE bool NanBooleanOptionValue(
		v8::Local<v8::Object> optionsObj
	, v8::Handle<v8::String> opt, bool def
) {
	if (def) {
		return optionsObj.IsEmpty()
			|| !optionsObj->Has(opt)
			|| optionsObj->Get(opt)->BooleanValue();
	} else {
		return !optionsObj.IsEmpty()
			&& optionsObj->Has(opt)
			&& optionsObj->Get(opt)->BooleanValue();
	}
}

// Method removed from NAN
NAN_INLINE uint32_t NanUInt32OptionValue(
		v8::Local<v8::Object> optionsObj
	, v8::Handle<v8::String> opt
	, uint32_t def
) {
	return !optionsObj.IsEmpty()
		&& optionsObj->Has(opt)
		&& optionsObj->Get(opt)->IsNumber()
			? optionsObj->Get(opt)->Uint32Value()
			: def;
}

#endif

