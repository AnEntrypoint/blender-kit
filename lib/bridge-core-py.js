'use strict';
const BRIDGE_PY_HEAD = `bl_info = {
    "name": "Blender Bridge (blender-kit)",
    "author": "blender-kit",
    "version": (1, 0, 0),
    "blender": (4, 0, 0),
    "location": "Runs automatically on enable",
    "description": "HTTP API server on port 6009 for agentic development with blender-dev CLI",
    "category": "Development",
}

import bpy
import json
import threading
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 6009
_server = None
_server_thread = None

def _get_obj_info(obj):
    return {
        "name": obj.name,
        "type": obj.type,
        "location": list(obj.location),
        "visible": not obj.hide_viewport,
    }


def _resolve_path(path_str):
    parts = path_str.split(".")
    obj = bpy
    for part in parts:
        if "[" in part:
            attr, rest = part.split("[", 1)
            key = rest.rstrip("]").strip('"').strip("'")
            obj = getattr(obj, attr)[key]
        else:
            obj = getattr(obj, part)
    return obj


def _serialize_value(v):
    try:
        return list(v)
    except TypeError:
        return v


def _gn_modifier(obj):
    for m in obj.modifiers:
        if m.type == 'NODES':
            return m
    return None


def _all_gn_modifiers(obj):
    return [m for m in obj.modifiers if m.type == 'NODES']


def _get_gn_inputs(ng, mod=None):
    result = []
    for item in ng.interface.items_tree:
        if item.item_type != 'SOCKET' or item.in_out != 'INPUT':
            continue
        entry = {"name": item.name, "identifier": item.identifier, "type": item.socket_type, "default": _serialize_value(item.default_value)}
        if hasattr(item, 'min_value') and item.min_value is not None:
            entry["min"] = item.min_value
        if hasattr(item, 'max_value') and item.max_value is not None:
            entry["max"] = item.max_value
        if mod is not None:
            try:
                entry["value"] = _serialize_value(mod[item.identifier])
            except (KeyError, TypeError):
                entry["value"] = entry["default"]
        else:
            entry["value"] = entry["default"]
        result.append(entry)
    return result

`;
module.exports = { BRIDGE_PY_HEAD };
