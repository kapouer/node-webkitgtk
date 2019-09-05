#ifndef WEBKITGTK_UTILS_H
#define WEBKITGTK_UTILS_H

#define ATTR(t, name, get, set) Nan::SetAccessor(t->InstanceTemplate(), Nan::New(name).ToLocalChecked(), get, set);
#define TOSTR(obj) (*String::Utf8Value((obj)->ToString()))
#define H(name) Nan::New<String>(name).ToLocalChecked()

#include <nan.h>
#include <glib.h>
#include <soup.h>

Nan::Utf8String* getOptStr(v8::Local<v8::Object>, const gchar*);
Nan::Callback* getCb(v8::Local<v8::Object>, const gchar*);
void update_soup_headers_with_dict(SoupMessageHeaders*, GVariant*);
GVariant* soup_headers_to_gvariant_dict(SoupMessageHeaders*);

// Method removed from NAN
NAN_INLINE bool NanBooleanOptionValue(
		v8::Local<v8::Object> optionsObj
	, v8::Local<v8::String> opt, bool def
) {
	if (def) {
		return optionsObj.IsEmpty()
			|| !Nan::Has(optionsObj, opt).FromJust()
			|| Nan::To<bool>(Nan::Get(optionsObj, opt).ToLocalChecked()).FromJust();
	} else {
		return !optionsObj.IsEmpty()
			&& Nan::Has(optionsObj, opt).FromJust()
			&& Nan::To<bool>(Nan::Get(optionsObj, opt).ToLocalChecked()).FromJust();
	}
}

// Method removed from NAN
NAN_INLINE uint32_t NanUInt32OptionValue(
		v8::Local<v8::Object> optionsObj
	, v8::Local<v8::String> opt
	, uint32_t def
) {
	return !optionsObj.IsEmpty()
		&& Nan::Has(optionsObj, opt).FromJust()
		&& Nan::Get(optionsObj, opt).ToLocalChecked()->IsNumber()
			? Nan::To<uint32_t>(Nan::Get(optionsObj, opt).ToLocalChecked()).FromJust()
			: def;
}

#endif

