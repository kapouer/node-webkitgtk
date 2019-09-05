#include "gvariantproxy.h"


using namespace v8;

Nan::Persistent<FunctionTemplate> GVariantProxy::constructor;

GVariantProxy::GVariantProxy() {
}

GVariantProxy::~GVariantProxy() {
	if (dict != NULL) {
		g_variant_dict_unref(dict);
		g_variant_unref(variant);
		dict = NULL;
		variant = NULL;
	}
}

void GVariantProxy::init(GVariant* var) {
	variant = var;
	dict = g_variant_dict_new(variant);
}

static NAN_PROPERTY_GETTER(GetNamedProperty) {
	Nan::HandleScope scope;
	GVariantProxy* self = node::ObjectWrap::Unwrap<GVariantProxy>(info.Holder());
	const gchar* val;
	if (self->dict != NULL) {
		Nan::Utf8String* prop = new Nan::Utf8String(property->ToString());
		if (!g_variant_dict_lookup(self->dict, **prop, "s", &val)) val = NULL;
		delete prop;
	}
	if (val == NULL) return;
	else info.GetReturnValue().Set(Nan::New<String>(val).ToLocalChecked());
}
static NAN_PROPERTY_SETTER(SetNamedProperty) {
	Nan::HandleScope scope;
	GVariantProxy* self = node::ObjectWrap::Unwrap<GVariantProxy>(info.Holder());
	if (self->dict == NULL) return;
	Nan::Utf8String* prop = new Nan::Utf8String(property->ToString());
	Nan::Utf8String* val = new Nan::Utf8String(value->ToString());
	gchar* valstr = NULL;
	if (!value->IsUndefined() && !value->IsNull()) {
		valstr = **val;
	}
	g_variant_dict_insert(self->dict, **prop, "s", valstr);
	delete val;
	delete prop;
	return;
}
static NAN_PROPERTY_QUERY(QueryNamedProperty) {
	Nan::HandleScope scope;
	gboolean hasProp = FALSE;
	GVariantProxy* self = node::ObjectWrap::Unwrap<GVariantProxy>(info.Holder());
	if (self->dict != NULL) {
		Nan::Utf8String* prop = new Nan::Utf8String(property->ToString());
		hasProp = g_variant_dict_contains(self->dict, **prop);
		delete prop;
	}
	info.GetReturnValue().Set(Nan::New<Integer>(hasProp));
}
static NAN_PROPERTY_DELETER(DeleteNamedProperty) {
	Nan::HandleScope scope;
	bool hasProp = FALSE;
	GVariantProxy* self = node::ObjectWrap::Unwrap<GVariantProxy>(info.Holder());
	Nan::Utf8String* prop = NULL;
	if (self->dict != NULL) {
		prop = new Nan::Utf8String(property->ToString());
		hasProp = g_variant_dict_contains(self->dict, **prop);
	}
	if (hasProp) {
		const gchar* stub = NULL;
		g_variant_dict_insert(self->dict, **prop, "s", &stub);
	}
	if (prop != NULL) delete prop;
	info.GetReturnValue().Set(Nan::New<Boolean>(hasProp));
}
static NAN_PROPERTY_ENUMERATOR(EnumerateNamedProperties) {
	Nan::HandleScope scope;
	Local<Array> array = Nan::New<Array>();
	GVariantProxy* self = node::ObjectWrap::Unwrap<GVariantProxy>(info.Holder());
	if (self->dict == NULL) info.GetReturnValue().Set(array);
	GVariantIter iter;
	GVariant* val;
	gchar* key;
	g_variant_iter_init(&iter, self->variant);
	int i = 0;
	while (g_variant_iter_next(&iter, "{sv}", &key, &val)) {
		if (!g_strcmp0(key, "uri")) continue;
		array->Set(Nan::New<Number>(i++), Nan::New<String>(key).ToLocalChecked());
		g_free(key);
	}
	info.GetReturnValue().Set(array);
}

void GVariantProxy::Init(Local<Object> target) {
	Nan::HandleScope scope;
	Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(GVariantProxy::New);
	Local<ObjectTemplate> otmpl = tpl->InstanceTemplate();
	otmpl->SetInternalFieldCount(1);

	Nan::SetNamedPropertyHandler(
		otmpl,
		GetNamedProperty,
		SetNamedProperty,
		QueryNamedProperty,
		DeleteNamedProperty,
		EnumerateNamedProperties
	);
	tpl->SetClassName(Nan::New("GVariantProxy").ToLocalChecked());
	target->Set(Nan::New("GVariantProxy").ToLocalChecked(), tpl->GetFunction());
	constructor.Reset(tpl);
}

NAN_METHOD(GVariantProxy::New) {
	Nan::HandleScope scope;
	GVariantProxy* self = new GVariantProxy();
	self->Wrap(info.This());
	info.GetReturnValue().Set(info.This());
}
