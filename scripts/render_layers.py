"""
Рендер машины в слоёные PNG. Шаг 8 из §14.

    blender -b assets/render/scene.blend -P scripts/render_layers.py -- --car <id>

Сцена настраивается один раз, дальше камера не двигается никогда: всё
совпадение слоёв по пикселям держится на этом. Параметры лежат в
assets/render/camera.json и версионируются в git — правка только с явного
разрешения человека и только вместе с полным перерендером библиотеки.

Что делает:
  1. Читает camera.json и применяет камеру, разрешение, плёнку и свет.
  2. Проходит по коллекциям машины, скрывает всё кроме целевой.
  3. Рендерит PNG в assets/sprites/<car_id>/<layer>.png.
  4. Пишет assets/sprites/<car_id>/layers.json с порядком наложения.

Кузов рендерится белым: цвет накладывается умножением в Canvas, поэтому
50 окрасок — это 50 строк конфига, а не 50 файлов (§11). Слой body_shade
кладётся поверх, чтобы машина не выглядела плоской заливкой.

Порядок работы — из скилла, не нарушать: сначала одна машина и один слой
body, показать человеку, дождаться подтверждения по камере и свету, потом
остальные слои этой машины, и только потом пакетный прогон.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAMERA_JSON = os.path.join(ROOT, "assets", "render", "camera.json")
SPRITES_DIR = os.path.join(ROOT, "assets", "sprites")

# Порядок наложения слоёв при отрисовке. Совпадает с порядком в src/render/car.ts:
# менять здесь — значит менять и там, иначе витрина и трасса разъедутся.
LAYER_ORDER = [
    "body",
    "body_shade",
    "vinyl",
    "bodykit",
    "glass",
    "spoiler",
    "exhaust",
    "wheels",
]


def parse_args():
    """Аргументы после `--`: всё до него съедает сам Blender."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    car = None
    only = None
    for i, item in enumerate(argv):
        if item == "--car" and i + 1 < len(argv):
            car = argv[i + 1]
        if item == "--layer" and i + 1 < len(argv):
            only = argv[i + 1]
    if car is None:
        raise SystemExit("Нужен --car <id>")
    return car, only


def load_config():
    with open(CAMERA_JSON, "r", encoding="utf-8") as handle:
        return json.load(handle)


def apply_camera(config):
    """Камера строго сбоку, ортографическая. Углы задаются числами, не мышью."""
    camera = bpy.data.objects.get("Camera")
    if camera is None:
        data = bpy.data.cameras.new("Camera")
        camera = bpy.data.objects.new("Camera", data)
        bpy.context.scene.collection.objects.link(camera)

    spec = config["camera"]
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = spec["ortho_scale"]
    camera.location = Vector((spec["location"]["x"], spec["location"]["y"], spec["location"]["z"]))
    camera.rotation_euler = (
        math.radians(spec["rotation_euler_deg"]["x"]),
        math.radians(spec["rotation_euler_deg"]["y"]),
        math.radians(spec["rotation_euler_deg"]["z"]),
    )
    bpy.context.scene.camera = camera


def apply_render(config):
    scene = bpy.context.scene
    spec = config["render"]
    scene.render.resolution_x = spec["resolution_x"]
    scene.render.resolution_y = spec["resolution_y"]
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = spec["film_transparent"]
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.engine = spec["engine"]
    if spec["engine"] == "CYCLES":
        scene.cycles.samples = spec["samples"]

    # Filter Size по умолчанию 1.5 — кромка выходит резкой.
    scene.render.filter_size = spec.get("filter_size", 2.2)

    # Тональная кривая. Standard — это её отсутствие: всё ярче единицы
    # становится плоским белым, и деталь под бликом пропадает.
    grade = config.get("color_management", {})
    view = scene.view_settings
    try:
        view.view_transform = grade.get("view_transform", "AgX")
    except TypeError:
        # В Blender 3.x AgX ещё нет, ближайшее — Filmic.
        view.view_transform = "Filmic"
    try:
        view.look = grade.get("look", "Medium Low Contrast")
    except TypeError:
        # Имя Look зависит от версии и от выбранного view transform.
        view.look = "None"
    view.exposure = grade.get("exposure", 0.0)


def apply_lights(config):
    """
    Свет одинаковый для всех деталей и всех машин. Разный свет — и слои
    выглядят вырезанными из разных картинок, ради чего всё это и затевалось.
    """
    for item in config["lights"]:
        obj = bpy.data.objects.get(item["name"])
        if obj is None:
            data = bpy.data.lights.new(item["name"], type=item["type"])
            obj = bpy.data.objects.new(item["name"], data)
            bpy.context.scene.collection.objects.link(obj)
        obj.data.type = item["type"]
        obj.data.energy = item["energy"]
        obj.data.color = item["color"]
        if hasattr(obj.data, "size"):
            obj.data.size = item["size"]
        # Оси в camera.json заданы в системе рендера (Y вверх), у Blender Z вверх.
        obj.location = Vector(to_blender(item["location"]))
        aim(obj, to_blender(item.get("target", [0.0, 0.7, 0.0])))


def to_blender(xyz):
    """(x, y, z) системы рендера -> (x, -z, y) системы Blender."""
    x, y, z = xyz
    return (x, -z, y)


def aim(obj, target):
    """Развернуть лампу на точку: -Z лампы смотрит в цель."""
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def car_collections(car_id):
    """Коллекции машины: <car_id>_<layer>. Всё остальное в сцене не наше."""
    found = {}
    prefix = car_id + "_"
    for collection in bpy.data.collections:
        if collection.name.startswith(prefix):
            found[collection.name[len(prefix):]] = collection
    return found


def hide_all(collections):
    for collection in collections.values():
        collection.hide_render = True


def render_layer(car_id, layer, collection, collections):
    hide_all(collections)
    collection.hide_render = False

    out_dir = os.path.join(SPRITES_DIR, car_id)
    os.makedirs(out_dir, exist_ok=True)
    bpy.context.scene.render.filepath = os.path.join(out_dir, layer + ".png")
    bpy.ops.render.render(write_still=True)
    return os.path.basename(bpy.context.scene.render.filepath)


def main():
    car_id, only = parse_args()
    config = load_config()

    apply_camera(config)
    apply_render(config)
    apply_lights(config)

    collections = car_collections(car_id)
    if not collections:
        raise SystemExit(
            "В сцене нет коллекций вида %s_<слой>. Ожидались: %s"
            % (car_id, ", ".join(config["layers"]))
        )

    rendered = []
    for layer in LAYER_ORDER:
        if layer not in collections:
            continue
        if only and layer != only:
            continue
        render_layer(car_id, layer, collections[layer], collections)
        rendered.append(layer)
        print("слой %s готов" % layer)

    # Порядок наложения нужен отрисовке: без него слои складывать нечем.
    manifest = {
        "car": car_id,
        "resolution": [config["render"]["resolution_x"], config["render"]["resolution_y"]],
        "car_length_m": config["car_length_m"],
        "order": rendered,
        # Винил принимает произвольную текстуру, а не набор пресетов — §8.
        # Слот держится в манифесте всегда, даже если картинки ещё нет.
        "vinyl_slot": True,
    }
    with open(os.path.join(SPRITES_DIR, car_id, "layers.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)

    print("готово: %d слоёв в assets/sprites/%s" % (len(rendered), car_id))


if __name__ == "__main__":
    main()
