'use strict';
const BRIDGE_RENDER_GET = `
            elif self.path == "/render/status":
                self.send_json(200, {"rendering": bpy.app.is_job_running("RENDER")})

            elif self.path == "/frame":
                scene = bpy.context.scene
                self.send_json(200, {"current": scene.frame_current, "start": scene.frame_start, "end": scene.frame_end, "fps": scene.render.fps})
`;

const BRIDGE_RENDER_POST = `
            elif self.path == "/render":
                output_path = body.get("output_path")
                frame = body.get("frame")
                animation = body.get("animation", False)
                if output_path:
                    bpy.context.scene.render.filepath = output_path
                if frame is not None:
                    bpy.context.scene.frame_set(frame)
                def _do_render():
                    bpy.ops.render.render(animation=animation, write_still=not animation)
                    return None
                bpy.app.timers.register(_do_render, first_interval=0)
                self.send_json(200, {"status": "started", "frame": bpy.context.scene.frame_current})

            elif self.path == "/frame":
                scene = bpy.context.scene
                if "current" in body:
                    scene.frame_set(int(body["current"]))
                if "start" in body:
                    scene.frame_start = int(body["start"])
                if "end" in body:
                    scene.frame_end = int(body["end"])
                self.send_json(200, {"current": scene.frame_current, "start": scene.frame_start, "end": scene.frame_end, "fps": scene.render.fps})

            elif self.path == "/render-settings":
                scene = bpy.context.scene
                r = scene.render
                if "engine" in body:
                    r.engine = body["engine"]
                if "resolution_x" in body:
                    r.resolution_x = int(body["resolution_x"])
                if "resolution_y" in body:
                    r.resolution_y = int(body["resolution_y"])
                if "resolution_percentage" in body:
                    r.resolution_percentage = int(body["resolution_percentage"])
                if "samples" in body and hasattr(scene, "cycles"):
                    scene.cycles.samples = int(body["samples"])
                if "output_path" in body:
                    r.filepath = body["output_path"]
                self.send_json(200, {"engine": r.engine, "resolution_x": r.resolution_x, "resolution_y": r.resolution_y})
`;
module.exports = { BRIDGE_RENDER_GET, BRIDGE_RENDER_POST };
