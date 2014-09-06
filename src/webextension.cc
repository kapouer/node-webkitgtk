#ifdef ENABLE_WEB_EXTENSION

#include <dbus/dbus-glib.h>
#include <webkit2/webkit-web-extension.h>
#include <JavaScriptCore/JSContextRef.h>
#include <JavaScriptCore/JSStringRef.h>
#include "dbus.h"

static GDBusConnection* connection;

static gboolean web_page_send_request(WebKitWebPage* web_page, WebKitURIRequest* request, WebKitURIResponse* redirected_response, gpointer data) {
	GError* error = NULL;
	const char* uri = webkit_uri_request_get_uri(request);
	GVariant* value = g_dbus_connection_call_sync(connection, NULL, DBUS_OBJECT_WKGTK, DBUS_INTERFACE_WKGTK,
		"HandleRequest", g_variant_new("(s)", uri), G_VARIANT_TYPE("(s)"), G_DBUS_CALL_FLAGS_NONE, -1, NULL,
		&error);
  if (value == NULL) {
		g_printerr("ERR %s\n", error->message);
		g_error_free(error);
		return FALSE;
	}
	const gchar* newuri;
  g_variant_get(value, "(&s)", &newuri);
	if (newuri != NULL && !g_strcmp0(newuri, "")) {
		return TRUE;
	} else if (g_strcmp0(uri, newuri)) {
		webkit_uri_request_set_uri(request, newuri);
	}
	g_variant_unref(value);
	return FALSE;
}


static void web_page_created_callback(WebKitWebExtension* extension, WebKitWebPage* web_page, gpointer data) {
	g_signal_connect(web_page, "send-request", G_CALLBACK(web_page_send_request), data);
}

/*
static void window_object_cleared_callback(WebKitScriptWorld* world, WebKitWebPage* web_page, WebKitFrame* frame, gpointer user_data) {
	// JSGlobalContextRef jsContext;
	// JSObjectRef        globalObject;
//
	// jsContext = webkit_frame_get_javascript_context_for_script_world(frame, world);
	// globalObject = JSContextGetGlobalObject(jsContext);
  // JSEvaluateScript(jsContext, JSStringCreateWithUTF8CString("document.cookie='wont=work'"), NULL, NULL, 1, NULL);
  // GError* error = NULL;
  // WebKitDOMDocument* dom = webkit_web_page_get_dom_document(web_page);
	// webkit_dom_document_set_cookie(dom, "mycookie=myval", &error);
	// if (error != NULL) g_printerr("Error in dom %s", error->message);
}
*/


extern "C" {
	G_MODULE_EXPORT void webkit_web_extension_initialize_with_user_data(WebKitWebExtension* extension, const GVariant* constData) {
		// constData will be the dbus object number
		// GVariant* data = g_variant_new_string(g_variant_get_string((GVariant*)constData, NULL));
		// note that page-created happens before window-object-cleared
		// g_signal_connect(webkit_script_world_get_default(), "window-object-cleared", G_CALLBACK(window_object_cleared_callback), NULL);

		gchar* address = NULL;
		g_variant_get((GVariant*)constData, "s", &address);

		g_signal_connect(extension, "page-created", G_CALLBACK(web_page_created_callback), NULL);

		GError* error = NULL;
		connection = g_dbus_connection_new_for_address_sync(address, G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT, NULL, NULL, &error);
		if (connection == NULL) {
			g_printerr("Failed to open connection to bus: %s\n", error->message);
      g_error_free(error);
    }
	}
}

#endif
