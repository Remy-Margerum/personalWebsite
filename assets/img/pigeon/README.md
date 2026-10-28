# Hero pigeon sprites

Sprite sheets for `assets/js/hero-pigeon.js`, the pigeon that flies into the
home-page tree (`assets/js/hero-tree.js`).

| Sheet          | Frames | Plays                                     |
| -------------- | ------ | ----------------------------------------- |
| `fly.webp`     | 12     | one wingbeat, looped while flying         |
| `land.webp`    | 49     | brake, touch down, fold wings             |
| `idle.webp`    | 73     | perched: looks around, turns to the viewer |
| `takeoff.webp` | 49     | crouch, launch, level flight              |

How they were made: the pigeon was cut out of an earlier photo-realistic
illustration (BiRefNet matting), placed on a green screen in a flying and a
perched pose, and the four moves were animated with Seedance 2.0 using those
two poses as fixed first/last frames — so every clip starts and ends on one
of two shared poses and they hand off without a jump. Frames were then
chroma-keyed, cleaned of stray specks, colour-matched back to the original
cut-outs, cropped to each clip's shared bounding box and packed into WebP
sheets at 0.26× the 960 px video frames (every second frame for the 12 fps
clips).

All sheets share one coordinate system (the 960 px video frame). The numbers
in the `SPRITE` block at the top of `hero-pigeon.js` — each sheet's cell size,
column count, frame count, the cell's offset in the video frame, the
perched-feet `anchor`, and the landing's touch-down / take-off's lift-off
points as fractions of the clip — must be updated together with the sheets.
The bird is AI-generated imagery.
