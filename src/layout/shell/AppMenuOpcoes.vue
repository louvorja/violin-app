<template>
  <div ref="root" class="opt">
    <section id="opt-sec-general" class="opt-section">
      <h3 class="opt-section-title">
        <Icon :icon="ICONS.UI.OPTIONS" size="18" />
        <span>{{ $t("options.general.title") }}</span>
      </h3>
      <div class="opt-row opt-row--field">
        <label class="opt-label" for="opt-theme">{{ $t("options.general.theme") }}</label>
        <select
          id="opt-theme"
          class="opt-select"
          :value="getUserData(KEYS.OPTIONS.THEME, 'darkblue')"
          @change="changeTheme($v($event))"
        >
          <option v-for="th in themes" :key="th.id" :value="th.id">{{ th.label }}</option>
        </select>
      </div>

      <div class="opt-row opt-row--field">
        <label class="opt-label" for="opt-language">{{ $t("options.general.language") }}</label>
        <select
          id="opt-language"
          class="opt-select"
          :value="getUserData(KEYS.OPTIONS.LANGUAGE, 'pt')"
          @change="changeLanguage($v($event))"
        >
          <option value="pt">Português</option>
          <option value="es">Español</option>
        </select>
      </div>

      <div class="opt-row opt-row--field">
        <label class="opt-label" for="opt-ui-style">{{ $t("options.general.ui_style") }}</label>
        <select
          id="opt-ui-style"
          class="opt-select"
          :value="getUserData(KEYS.OPTIONS.UI_STYLE, THEMES.CLASSIC)"
          @change="saveUserData(KEYS.OPTIONS.UI_STYLE, $v($event))"
        >
          <option v-for="t in THEMES" :key="t.toString()" :value="t">
            {{ t.toString().toUpperCase() }}
          </option>
        </select>
      </div>

      <div class="opt-row opt-row--field">
        <label class="opt-label" for="opt-font">{{ $t("options.general.font") }}</label>
        <SelectFont
          id="opt-font"
          :model-value="getUserData(KEYS.OPTIONS.FONT, '')"
          :show-interface-default="false"
          :show-projection-default="false"
          :default-font="FONT.UI.FALLBACK"
          @update:model-value="saveUserData(KEYS.OPTIONS.FONT, $event)"
        />
      </div>

      <div class="opt-row opt-row--field">
        <label class="opt-label" for="opt-projection-font">
          {{ $t("options.general.projection_font") }}
        </label>
        <SelectFont
          id="opt-projection-font"
          :model-value="getUserData(KEYS.OPTIONS.PROJECTION_FONT, '')"
          :show-projection-default="false"
          :show-interface-default="false"
          :default-font="FONT.PROJECTION.FALLBACK"
          @update:model-value="saveUserData(KEYS.OPTIONS.PROJECTION_FONT, $event)"
        />
      </div>

      <div v-if="isDesktop" class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="getUserData(KEYS.OPTIONS.START_WITH_OS, false)"
            @change="toggleStartWithOS($c($event))"
          />
          <span>{{ $t("options.general.start_with_os") }}</span>
        </label>
      </div>
      <div class="opt-bg">
        <div class="opt-bg-fields">
          <div class="opt-row opt-row--field">
            <label class="opt-label" for="opt-bg-color">
              {{ $t("options.background.color") }}
            </label>
            <input
              id="opt-bg-color"
              type="color"
              class="opt-color"
              :value="bgColor"
              @input="onBgColorChange"
            />
          </div>

          <div class="opt-row opt-row--field">
            <span class="opt-label">{{ $t("options.background.title") }}</span>
            <div class="opt-bg-pick">
              <LjButton variant="default" size="sm" @click="pickBgImage">
                <Icon start :icon="ICONS.ACTIONS.IMAGE_PLUS" size="14" />
                {{ $t("options.background.select") }}
              </LjButton>
              <span v-if="!currentBgImage" class="opt-bg-empty-text">
                {{ $t("options.background.no_image") }}
              </span>
            </div>
          </div>

          <div class="opt-row opt-row--field">
            <label class="opt-label" for="opt-bg-position">
              {{ $t("options.background.position") }}
            </label>
            <select
              id="opt-bg-position"
              class="opt-select"
              :value="bgPosition"
              @change="onBgPositionChange"
            >
              <option value="cover">{{ $t("options.slides.pos_cover") }}</option>
              <option value="contain">{{ $t("options.slides.pos_contain") }}</option>
              <option value="center">{{ $t("options.slides.pos_center") }}</option>
              <option value="stretch">{{ $t("options.slides.pos_stretch") }}</option>
              <option value="tile">{{ $t("options.slides.pos_tile") }}</option>
            </select>
          </div>
        </div>

        <div class="opt-bg-preview-wrap">
          <span class="opt-bg-preview-caption">{{ $t("options.slides.preview") }}</span>
          <MonitorShape
            :width="previewMonitorW"
            :height="previewMonitorH"
            :height-base="130"
            :max-width="280"
            :remove="!!currentBgImage"
            :remove-label="$t('options.slides.remove_image')"
            @remove="removeBgImage"
          >
            <div class="opt-bg-preview-screen" :style="{ backgroundColor: bgColor }">
              <img
                v-if="currentBgImage"
                :src="currentBgImage"
                class="opt-bg-preview-img"
                alt="img background"
              />
            </div>
          </MonitorShape>
        </div>
      </div>
    </section>

    <section id="opt-sec-monitors" class="opt-section">
      <h3 class="opt-section-title">
        <Icon :icon="ICONS.UI.MONITORS" size="18" />
        <span>{{ $t("options.monitors.title") }}</span>
      </h3>
      <div v-if="displays.length === 0" class="opt-empty">
        <template v-if="screenAccess === 'prompt'">
          <p>{{ $t("options.monitors.web_prompt") }}</p>
          <button type="button" class="opt-btn" @click="requestScreenAccess">
            {{ $t("options.monitors.web_detect") }}
          </button>
        </template>
        <template v-else-if="screenAccess === 'denied'">
          {{ $t("options.monitors.web_denied") }}
        </template>
        <template v-else-if="screenAccess === 'unsupported'">
          {{ $t("options.monitors.web_unsupported") }}
        </template>
        <template v-else-if="screenAccess === 'granted'">
          {{ $t("options.monitors.web_single") }}
        </template>
        <template v-else>
          {{ $t("options.monitors.no_displays") }}
        </template>
      </div>

      <div v-else>
        <div class="opt-monitors">
          <MonitorShape
            v-for="d in displays"
            :key="d.id"
            :width="d.bounds?.width"
            :height="d.bounds?.height"
            :primary="d.primary"
            :height-base="150"
            :max-width="260"
          >
            <div class="opt-monitor-info">
              <div class="opt-monitor-num">{{ d.number ?? (d.index ?? 0) + 1 }}</div>
              <div v-if="d.name" class="opt-monitor-name">{{ d.name }}</div>
              <div class="opt-monitor-size">
                {{ d.bounds?.width || "?" }} x {{ d.bounds?.height || "?" }}
              </div>
            </div>
          </MonitorShape>
        </div>

        <button type="button" class="opt-btn" @click="identify(5000)">
          {{ $t("options.monitors.identify") }}
        </button>

        <!-- Tela cheia automática: o site não pode pedir essa permissão nem
             consultá-la; só o usuário libera. Mostramos o estado deduzido da
             última projeção e como resolver. -->
        <div v-if="autoFullscreen !== 'native'" class="opt-row opt-row--stack">
          <span class="opt-label">{{ $t("options.monitors.auto_fullscreen_title") }}</span>
          <div>
            <span v-if="autoFullscreen === 'granted'" class="opt-hint">
              {{ $t("options.monitors.auto_fullscreen_granted") }}
            </span>
            <span v-else class="opt-hint">
              {{ $t("options.monitors.auto_fullscreen_blocked") }}
            </span>
          </div>
        </div>

        <p class="opt-hint">{{ $t("options.monitors.assign_hint") }}</p>

        <div v-for="role in roleRows" :key="role.role" class="opt-row">
          <label class="opt-label" :for="`opt-monitor-role-${role.role}`">
            {{ role.label }}
          </label>
          <select
            :id="`opt-monitor-role-${role.role}`"
            class="opt-select"
            :value="role.displayId ?? ''"
            @change="setRole(role.role, $v($event) === '' ? null : $v($event))"
          >
            <option value="">{{ $t("options.slides.none") }}</option>
            <option v-for="d in displays" :key="d.id" :value="d.id">
              {{ d.label || `Monitor ${d.id}` }}
            </option>
          </select>
          <span v-if="role.warning" class="opt-monitor-warning">{{ role.warning }}</span>
        </div>
      </div>
    </section>

    <section id="opt-sec-bible" class="opt-section">
      <h3 class="opt-section-title">
        <Icon :icon="ICONS.BIBLE.BIBLE" size="18" />
        <span>{{ $t("options.bible.title") }}</span>
      </h3>
      <div class="opt-row">
        <label class="opt-label" for="opt-bible-monitor">{{ $t("options.bible.open_at") }}</label>
        <MonitorSelect
          id="opt-bible-monitor"
          :model-value="getPref('bible') ?? ''"
          @update:model-value="setPref('bible', $event)"
        />
      </div>

      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="bibleReturnEnabled"
            @change="saveUserData(KEYS.MODULES.BIBLE.SHOW_RETURN, $c($event))"
          />
          <span>{{ $t("options.bible.show_return") }}</span>
        </label>
      </div>

      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="getUserData(KEYS.MODULES.BIBLE.ESC_CLOSES_PROJECTION, false)"
            @change="saveUserData(KEYS.MODULES.BIBLE.ESC_CLOSES_PROJECTION, $c($event))"
          />
          <span>{{ $t("options.bible.esc_closes_projection") }}</span>
        </label>
      </div>
      <div v-if="bibleReturnEnabled" class="opt-row">
        <label class="opt-label" for="opt-bible-return-monitor">
          {{ $t("options.bible.open_return_at") }}
        </label>
        <MonitorSelect
          id="opt-bible-return-monitor"
          :model-value="getPref('bible_return') ?? ''"
          @update:model-value="setPref('bible_return', $event)"
        />
      </div>

      <div class="opt-row opt-row--field">
        <label class="opt-label" for="opt-bible-font">{{ $t("options.bible.font") }}</label>
        <SelectFont
          id="opt-bible-font"
          :model-value="$userdata.get(KEYS.MODULES.BIBLE.FONT, '')"
          @update:model-value="saveUserData(KEYS.MODULES.BIBLE.FONT, $event)"
        />
      </div>
    </section>

    <section id="opt-sec-slides" class="opt-section">
      <h3 class="opt-section-title">
        <Icon :icon="ICONS.MUSIC.MUSIC" size="18" />
        <span>{{ $t("options.slides.title") }}</span>
      </h3>
      <div class="opt-row">
        <label class="opt-label" for="opt-slides-monitor">
          {{ $t("options.slides.open_at") }}
        </label>
        <MonitorSelect
          id="opt-slides-monitor"
          :model-value="getPref('musicas') ?? ''"
          @update:model-value="setPref('musicas', $event)"
        />
      </div>

      <div class="opt-row">
        <label class="opt-label" for="opt-slides-align">
          {{ $t("options.slides.alignment") }}
        </label>
        <select
          id="opt-slides-align"
          class="opt-select"
          :value="getUserData(KEYS.OPTIONS.SLIDE.TEXT_ALIGN, 'center')"
          @change="saveUserData(KEYS.OPTIONS.SLIDE.TEXT_ALIGN, $v($event))"
        >
          <option value="top">{{ $t("options.slides.align_top") }}</option>
          <option value="center">{{ $t("options.slides.align_center") }}</option>
          <option value="bottom">{{ $t("options.slides.align_bottom") }}</option>
        </select>
      </div>
      <div class="opt-row opt-row--field">
        <label class="opt-label" for="opt-slides-font">{{ $t("options.slides.font") }}</label>
        <SelectFont
          id="opt-slides-font"
          :model-value="getUserData(KEYS.OPTIONS.SLIDE.FONT, '')"
          @update:model-value="saveUserData(KEYS.OPTIONS.SLIDE.FONT, $event)"
        />
      </div>
      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="getUserData(KEYS.OPTIONS.FULLSCREEN, true)"
            @change="saveUserData(KEYS.OPTIONS.FULLSCREEN, $c($event))"
          />
          <span>{{ $t("options.slides.fullscreen") }}</span>
        </label>
      </div>

      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="getUserData(KEYS.OPTIONS.ALWAYS_ON_TOP, true)"
            @change="saveUserData(KEYS.OPTIONS.ALWAYS_ON_TOP, $c($event))"
          />
          <span>{{ $t("options.slides.always_on_top") }}</span>
        </label>
      </div>

      <!--      Configurações da tela do operador  -->
      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="getUserData(KEYS.OPTIONS.OPEN_OPERATOR, false)"
            @change="saveUserData(KEYS.OPTIONS.OPEN_OPERATOR, $c($event))"
          />
          <span>{{ $t("options.slides.open_operator") }}</span>
        </label>
        <MonitorSelect
          v-if="getUserData(KEYS.OPTIONS.OPEN_OPERATOR, false)"
          inline
          :aria-label="$t('options.slides.open_operator')"
          :model-value="getPref('operador') ?? ''"
          @update:model-value="setPref('operador', $event)"
        />
      </div>

      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="getUserData(KEYS.OPTIONS.OPEN_RETURN, false)"
            @change="saveUserData(KEYS.OPTIONS.OPEN_RETURN, $c($event))"
          />
          <span>{{ $t("options.slides.open_return") }}</span>
        </label>
        <MonitorSelect
          v-if="getUserData(KEYS.OPTIONS.OPEN_RETURN, false)"
          inline
          :aria-label="$t('options.slides.open_return')"
          :model-value="getPref('retorno') ?? ''"
          @update:model-value="setPref('retorno', $event)"
        />
      </div>

      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="getUserData(KEYS.OPTIONS.SLIDE.SHOW_TITLE_FIRST_SLIDE, true)"
            @change="saveUserData(KEYS.OPTIONS.SLIDE.SHOW_TITLE_FIRST_SLIDE, $c($event))"
          />
          <span>{{ $t("options.slides.show_title") }}</span>
        </label>
      </div>

      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="getUserData(KEYS.OPTIONS.MINIMIZE_ON_START, false)"
            @change="saveUserData(KEYS.OPTIONS.MINIMIZE_ON_START, $c($event))"
          />
          <span>{{ $t("options.slides.minimize_on_start") }}</span>
        </label>
      </div>

      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="getUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR_ENABLED, false)"
            @change="saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR_ENABLED, $c($event))"
          />
          <span>{{ $t("options.slides.text_bg_blur_enabled") }}</span>
        </label>
      </div>

      <!-- Formatação de texto personalizada -->
      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="getUserData(KEYS.OPTIONS.SLIDE.CUSTOM_TEXT_FORMAT, false)"
            @change="saveUserData(KEYS.OPTIONS.SLIDE.CUSTOM_TEXT_FORMAT, $c($event))"
          />
          <span>{{ $t("options.slides.custom_text_format") }}</span>
        </label>
      </div>
      <div
        v-if="getUserData(KEYS.OPTIONS.SLIDE.CUSTOM_TEXT_FORMAT, false)"
        class="opt-format-block"
      >
        <v-row>
          <v-col cols="12" sm="3">
            <div class="opt-format-row">
              <label class="opt-format-field">
                <span class="opt-format-label">{{ $t("options.slides.title_color") }}</span>
                <input
                  type="color"
                  class="opt-color"
                  :value="getUserData(KEYS.OPTIONS.SLIDE.TITLE_COLOR, '#ffd84d')"
                  @input="saveUserData(KEYS.OPTIONS.SLIDE.TITLE_COLOR, $v($event))"
                />
              </label>

              <label class="opt-format-field">
                <span class="opt-format-label">{{ $t("options.slides.text_color") }}</span>
                <input
                  type="color"
                  class="opt-color"
                  :value="getUserData(KEYS.OPTIONS.SLIDE.TEXT_COLOR, '#ffffff')"
                  @input="saveUserData(KEYS.OPTIONS.SLIDE.TEXT_COLOR, $v($event))"
                />
              </label>

              <label class="opt-format-field">
                <span class="opt-format-label">{{ $t("options.slides.repeat_color") }}</span>
                <input
                  type="color"
                  class="opt-color"
                  :value="getUserData(KEYS.OPTIONS.SLIDE.REPEAT_COLOR, '#bbbbbb')"
                  @input="saveUserData(KEYS.OPTIONS.SLIDE.REPEAT_COLOR, $v($event))"
                />
              </label>

              <label class="opt-format-field">
                <span class="opt-format-label">{{ $t("options.slides.aux_color") }}</span>
                <input
                  type="color"
                  class="opt-color"
                  :value="getUserData(KEYS.OPTIONS.SLIDE.AUX_COLOR, '#cccccc')"
                  @input="saveUserData(KEYS.OPTIONS.SLIDE.AUX_COLOR, $v($event))"
                />
              </label>
            </div>

            <div class="opt-format-row">
              <label class="opt-format-field">
                <span class="opt-format-label">{{ $t("options.slides.title_size") }}</span>
                <input
                  type="number"
                  min="6"
                  max="60"
                  class="opt-input opt-input--num"
                  :value="getUserData(KEYS.OPTIONS.SLIDE.TITLE_SIZE, 18)"
                  @input="saveUserData(KEYS.OPTIONS.SLIDE.TITLE_SIZE, Number($v($event)) || 18)"
                />
              </label>

              <label class="opt-format-field">
                <span class="opt-format-label">{{ $t("options.slides.text_size_label") }}</span>
                <input
                  type="number"
                  min="6"
                  max="60"
                  class="opt-input opt-input--num"
                  :value="getUserData(KEYS.OPTIONS.SLIDE.BODY_SIZE, 14)"
                  @input="saveUserData(KEYS.OPTIONS.SLIDE.BODY_SIZE, Number($v($event)) || 14)"
                />
              </label>

              <label class="opt-format-field">
                <span class="opt-format-label">{{ $t("options.slides.aux_size") }}</span>
                <input
                  type="number"
                  min="6"
                  max="60"
                  class="opt-input opt-input--num"
                  :value="getUserData(KEYS.OPTIONS.SLIDE.AUX_SIZE, 10)"
                  @input="saveUserData(KEYS.OPTIONS.SLIDE.AUX_SIZE, Number($v($event)) || 10)"
                />
              </label>
            </div>
          </v-col>
          <v-col cols="12" sm="4">
            <label class="opt-checkbox opt-format-check">
              <input
                type="checkbox"
                :checked="getUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_TRANSPARENT, false)"
                @change="saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_TRANSPARENT, $c($event))"
              />
              <span>{{ $t("options.slides.text_bg_transparent") }}</span>
            </label>

            <label class="opt-checkbox opt-format-check ml-3">
              <input
                type="checkbox"
                :checked="getUserData(KEYS.OPTIONS.SLIDE.SHADOW_ENABLED, false)"
                @change="saveUserData(KEYS.OPTIONS.SLIDE.SHADOW_ENABLED, $c($event))"
              />
              <span>{{ $t("options.slides.shadow_enabled") }}</span>
            </label>

            <div
              v-if="getUserData(KEYS.OPTIONS.SLIDE.SHADOW_ENABLED, false)"
              class="opt-format-row"
            >
              <label class="opt-format-field">
                <span class="opt-format-label">{{ $t("options.slides.shadow_color") }}</span>
                <input
                  type="color"
                  class="opt-color"
                  :value="getUserData(KEYS.OPTIONS.SLIDE.SHADOW_COLOR, '#000000')"
                  @input="saveUserData(KEYS.OPTIONS.SLIDE.SHADOW_COLOR, $v($event))"
                />
              </label>
              <label class="opt-format-field">
                <span class="opt-format-label">{{ $t("options.slides.shadow_blur") }}</span>
                <input
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                  class="opt-range"
                  :value="getUserData(KEYS.OPTIONS.SLIDE.SHADOW_BLUR, 12)"
                  @input="saveUserData(KEYS.OPTIONS.SLIDE.SHADOW_BLUR, Number($v($event)))"
                />
                <span class="opt-range-val">
                  {{ getUserData(KEYS.OPTIONS.SLIDE.SHADOW_BLUR, 12) }}px
                </span>
              </label>
              <label class="opt-format-field">
                <span class="opt-format-label">{{ $t("options.slides.shadow_offset_x") }}</span>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  step="1"
                  class="opt-range"
                  :value="getUserData(KEYS.OPTIONS.SLIDE.SHADOW_OFFSET_X, 0)"
                  @input="saveUserData(KEYS.OPTIONS.SLIDE.SHADOW_OFFSET_X, Number($v($event)))"
                />
                <span class="opt-range-val">
                  {{ getUserData(KEYS.OPTIONS.SLIDE.SHADOW_OFFSET_X, 0) }}px
                </span>
              </label>
              <label class="opt-format-field">
                <span class="opt-format-label">{{ $t("options.slides.shadow_offset_y") }}</span>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  step="1"
                  class="opt-range"
                  :value="getUserData(KEYS.OPTIONS.SLIDE.SHADOW_OFFSET_Y, 2)"
                  @input="saveUserData(KEYS.OPTIONS.SLIDE.SHADOW_OFFSET_Y, Number($v($event)))"
                />
                <span class="opt-range-val">
                  {{ getUserData(KEYS.OPTIONS.SLIDE.SHADOW_OFFSET_Y, 2) }}px
                </span>
              </label>
            </div>
          </v-col>
          <v-col cols="12" sm="5">
            <label class="opt-checkbox opt-format-check">
              <input
                type="checkbox"
                :checked="getUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR_ENABLED, false)"
                @change="saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR_ENABLED, $c($event))"
              />
              <span>{{ $t("options.slides.text_bg_blur_enabled") }}</span>
            </label>

            <div
              v-if="getUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR_ENABLED, false)"
              class="opt-format-row"
            >
              <label class="opt-format-field">
                <span class="opt-format-label">{{ $t("options.slides.text_bg_blur") }}</span>
                <input
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                  class="opt-range"
                  :value="getUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR, 12)"
                  @input="saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR, Number($v($event)))"
                />
                <span class="opt-range-val">
                  {{ getUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR, 12) }}px
                </span>
              </label>
            </div>

            <label class="opt-checkbox opt-format-check">
              <input
                type="checkbox"
                :checked="getUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_ENABLED, false)"
                @change="saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_ENABLED, $c($event))"
              />
              <span>{{ $t("options.slides.text_border_enabled") }}</span>
            </label>

            <div
              v-if="getUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_ENABLED, false)"
              class="opt-format-row"
            >
              <label class="opt-format-field">
                <span class="opt-format-label">{{ $t("options.slides.text_border_color") }}</span>
                <input
                  type="color"
                  class="opt-color"
                  :value="getUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_COLOR, '#ffffff')"
                  @input="saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_COLOR, $v($event))"
                />
              </label>
              <label class="opt-format-field">
                <span class="opt-format-label">{{ $t("options.slides.text_border_width") }}</span>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  class="opt-range"
                  :value="getUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_WIDTH, 2)"
                  @input="saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_WIDTH, Number($v($event)))"
                />
                <span class="opt-range-val">
                  {{ getUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_WIDTH, 2) }}px
                </span>
              </label>
            </div>
          </v-col>
        </v-row>
        <button type="button" class="opt-btn opt-btn--ghost" @click="restoreTextFormat">
          <Icon :icon="ICONS.ACTIONS.REFRESH" size="14" class="mr-1" />
          {{ $t("options.slides.restore") }}
        </button>
      </div>

      <!-- Formatação de texto do retorno personalizada -->
      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="getUserData(KEYS.OPTIONS.SLIDE.CUSTOM_RETURN_TEXT_FORMAT, false)"
            @change="saveUserData(KEYS.OPTIONS.SLIDE.CUSTOM_RETURN_TEXT_FORMAT, $c($event))"
          />
          <span>{{ $t("options.slides.custom_return_text_format") }}</span>
        </label>
      </div>
      <div
        v-if="getUserData(KEYS.OPTIONS.SLIDE.CUSTOM_RETURN_TEXT_FORMAT, false)"
        class="opt-format-block"
      >
        <div class="opt-format-row">
          <label class="opt-format-field">
            <span class="opt-format-label">{{ $t("options.slides.text_case") }}</span>
            <select
              class="opt-select"
              :value="getUserData(KEYS.OPTIONS.SLIDE.RETURN_TEXT_CASE, 'uppercase')"
              @change="saveUserData(KEYS.OPTIONS.SLIDE.RETURN_TEXT_CASE, $v($event))"
            >
              <option value="normal">{{ $t("options.slides.case_normal") }}</option>
              <option value="capitalize">{{ $t("options.slides.case_capitalize") }}</option>
              <option value="uppercase">{{ $t("options.slides.case_uppercase") }}</option>
            </select>
          </label>
          <label class="opt-format-field">
            <span class="opt-format-label">{{ $t("options.slides.text_size") }}</span>
            <input
              type="number"
              min="3"
              max="15"
              class="opt-input opt-input--num"
              :value="getUserData(KEYS.OPTIONS.SLIDE.FONT_SIZE_NEXT, 6)"
              @input="saveUserData(KEYS.OPTIONS.SLIDE.FONT_SIZE_NEXT, Number($v($event)) || 6)"
            />
          </label>
        </div>
      </div>

      <!-- Fundo personalizado -->
      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="getUserData(KEYS.OPTIONS.SLIDE.CUSTOM_BACKGROUND, false)"
            @change="saveUserData(KEYS.OPTIONS.SLIDE.CUSTOM_BACKGROUND, $c($event))"
          />
          <span>{{ $t("options.slides.custom_background") }}</span>
        </label>
      </div>
      <div v-if="getUserData(KEYS.OPTIONS.SLIDE.CUSTOM_BACKGROUND, false)" class="opt-format-block">
        <div class="opt-format-row">
          <label class="opt-checkbox opt-format-check">
            <input
              type="checkbox"
              :checked="getUserData(KEYS.OPTIONS.SLIDE.BG_TRANSPARENT, false)"
              @change="saveUserData(KEYS.OPTIONS.SLIDE.BG_TRANSPARENT, $c($event))"
            />
            <span>{{ $t("options.slides.bg_transparent") }}</span>
          </label>
          <label class="opt-format-field">
            <span class="opt-format-label">{{ $t("options.slides.bg_color") }}</span>
            <input
              type="color"
              class="opt-color"
              :value="getUserData(KEYS.OPTIONS.SLIDE.BG_COLOR, '#000000')"
              @input="saveUserData(KEYS.OPTIONS.SLIDE.BG_COLOR, $v($event))"
            />
          </label>
          <label class="opt-format-field opt-format-field--grow">
            <span class="opt-format-label">{{ $t("options.slides.bg_image") }}</span>
            <input
              type="text"
              class="opt-input"
              :value="getUserData(KEYS.OPTIONS.SLIDE.BG_IMAGE, '')"
              :placeholder="$t('options.slides.bg_image_placeholder')"
              @input="saveUserData(KEYS.OPTIONS.SLIDE.BG_IMAGE, $v($event))"
            />
          </label>
          <label class="opt-format-field">
            <span class="opt-format-label">{{ $t("options.slides.bg_position") }}</span>
            <select
              class="opt-select"
              :value="getUserData(KEYS.OPTIONS.SLIDE.BG_POSITION, 'center')"
              @change="saveUserData(KEYS.OPTIONS.SLIDE.BG_POSITION, $v($event))"
            >
              <option value="center">{{ $t("options.slides.pos_center") }}</option>
              <option value="cover">{{ $t("options.slides.pos_cover") }}</option>
              <option value="contain">{{ $t("options.slides.pos_contain") }}</option>
              <option value="stretch">{{ $t("options.slides.pos_stretch") }}</option>
              <option value="tile">{{ $t("options.slides.pos_tile") }}</option>
            </select>
          </label>
        </div>
      </div>

      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="getUserData(KEYS.OPTIONS.SLIDE.AFFECT_EXTERNAL_SLIDES, true)"
            @change="saveUserData(KEYS.OPTIONS.SLIDE.AFFECT_EXTERNAL_SLIDES, $c($event))"
          />
          <span>{{ $t("options.slides.affect_external") }}</span>
        </label>
      </div>
    </section>

    <section id="opt-sec-videos" class="opt-section">
      <h3 class="opt-section-title">
        <Icon :icon="ICONS.MEDIA.YOUTUBE" size="18" />
        <span>{{ $t("options.videos.title") }}</span>
      </h3>
      <div class="opt-row">
        <label class="opt-label" for="opt-videos-monitor">
          {{ $t("options.slides.open_at") }}
        </label>
        <MonitorSelect
          id="opt-videos-monitor"
          :model-value="getPref('online_video') ?? ''"
          @update:model-value="setPref('online_video', $event)"
        />
      </div>

      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="videoProjFullscreen"
            @change="saveUserData(KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.FULLSCREEN, $c($event))"
          />
          <span>{{ $t("options.videos.fullscreen") }}</span>
        </label>
      </div>

      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="videoProjAlwaysOnTop"
            @change="saveUserData(KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.ALWAYS_ON_TOP, $c($event))"
          />
          <span>{{ $t("options.videos.always_on_top") }}</span>
        </label>
      </div>

      <div class="opt-row">
        <label class="opt-label" for="opt-youtube-action">
          {{ $t("options.videos.youtube_action") }}
        </label>
        <select
          id="opt-youtube-action"
          class="opt-select"
          :value="getUserData(KEYS.OPTIONS.YOUTUBE_ACTION, 'video')"
          @change="saveUserData(KEYS.OPTIONS.YOUTUBE_ACTION, $v($event))"
        >
          <option value="video">{{ $t("options.videos.action_video") }}</option>
          <option value="link">{{ $t("options.videos.action_link") }}</option>
        </select>
      </div>
      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="vidProjShowReturn"
            @change="saveUserData(KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.SHOW_RETURN, $c($event))"
          />
          <span>{{ $t("options.videos.show_return") }}</span>
        </label>
      </div>
      <div v-if="vidProjShowReturn" class="opt-row">
        <label class="opt-label" for="opt-video-return-monitor">
          {{ $t("options.slides.open_file_return_at") }}
        </label>
        <MonitorSelect
          id="opt-video-return-monitor"
          :model-value="getPref('online_video_return') ?? ''"
          @update:model-value="setPref('online_video_return', $event)"
        />
      </div>
    </section>

    <section id="opt-sec-player" class="opt-section">
      <h3 class="opt-section-title">
        <Icon :icon="ICONS.PLAYER.PLAY_PAUSE" size="18" />
        <span>{{ $t("options.player.title") }}</span>
      </h3>
      <div class="opt-row">
        <label class="opt-label" for="opt-file-proj-monitor">
          {{ $t("options.slides.open_file_at") }}
        </label>
        <MonitorSelect
          id="opt-file-proj-monitor"
          :model-value="getPref('file_projection') ?? ''"
          @update:model-value="setPref('file_projection', $event)"
        />
      </div>

      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="fileProjFullscreen"
            @change="saveUserData(KEYS.OPTIONS.FILE_PROJECTION.FULLSCREEN, $c($event))"
          />
          <span>{{ $t("options.player.fullscreen") }}</span>
        </label>
      </div>

      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="fileProjAlwaysOnTop"
            @change="saveUserData(KEYS.OPTIONS.FILE_PROJECTION.ALWAYS_ON_TOP, $c($event))"
          />
          <span>{{ $t("options.player.always_on_top") }}</span>
        </label>
      </div>

      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="fileProjShowReturn"
            @change="saveUserData(KEYS.OPTIONS.FILE_PROJECTION.SHOW_RETURN, $c($event))"
          />
          <span>{{ $t("options.player.show_return") }}</span>
        </label>
      </div>
      <div v-if="fileProjShowReturn" class="opt-row">
        <label class="opt-label" for="opt-file-return-monitor">
          {{ $t("options.slides.open_file_return_at") }}
        </label>
        <MonitorSelect
          id="opt-file-return-monitor"
          :model-value="getPref('file_return') ?? ''"
          @update:model-value="setPref('file_return', $event)"
        />
      </div>

      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="mediaFadeAudio"
            @change="setMedia('fade_audio', $c($event))"
          />
          <span>{{ $t("options.player.fade_audio") }}</span>
        </label>
      </div>
      <p class="opt-hint">{{ $t("options.player.fade_audio_hint") }}</p>

      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="mediaLazyLoad"
            @change="setMedia('lazy_load', $c($event))"
          />
          <span>{{ $t("options.player.lazy_load") }}</span>
        </label>
      </div>
    </section>

    <section id="opt-sec-file_projection" class="opt-section">
      <h3 class="opt-section-title">
        <Icon :icon="ICONS.UI.FILE" size="18" />
        <span>{{ $t("options.file_projection.title") }}</span>
      </h3>
      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="fileProjectionFade"
            @change="setFileProj('fade', $c($event))"
          />
          <span>{{ $t("options.file_projection.fade") }}</span>
        </label>
      </div>

      <div v-if="fileProjectionFade" class="opt-row">
        <label class="opt-label" for="opt-fade-duration">
          {{ $t("options.file_projection.fade_duration") }}
        </label>
        <div class="opt-range-group">
          <input
            id="opt-fade-duration"
            type="range"
            min="0"
            max="3000"
            step="100"
            class="opt-range"
            :value="fileProjectionFadeDuration"
            @input="setFileProj('fade_duration', Number($v($event)))"
          />
          <input
            type="number"
            min="0"
            max="5000"
            step="100"
            class="opt-input opt-input--num"
            style="width: 80px"
            :value="fileProjectionFadeDuration"
            @input="setFileProj('fade_duration', Number($v($event)) || 500)"
          />
          <span class="opt-unit">ms</span>
        </div>
      </div>

      <v-divider class="opt-divider" />

      <div class="opt-row">
        <label class="opt-checkbox">
          <input type="checkbox" :checked="fileProjBgEnabled" @change="toggleFileProjBg" />
          <span>{{ $t("options.file_projection.custom_background") }}</span>
        </label>
      </div>

      <template v-if="fileProjBgEnabled">
        <div class="opt-row">
          <label class="opt-label" for="opt-fp-bg-color">
            {{ $t("options.background.color") }}
          </label>
          <input
            id="opt-fp-bg-color"
            type="color"
            class="opt-color"
            :value="fileProjBgColor"
            @input="onFileProjBgColor"
          />
        </div>

        <div class="opt-row">
          <span class="opt-label">{{ $t("options.background.title") }}</span>
          <div class="opt-bg-pick">
            <LjButton variant="default" size="sm" @click="pickFileProjBgImage">
              <Icon start :icon="ICONS.ACTIONS.IMAGE_PLUS" size="16" />
              {{ $t("options.background.select") }}
            </LjButton>
            <span v-if="!fileProjBgImageUrl" class="opt-bg-empty-text">
              {{ $t("options.background.no_image") }}
            </span>
            <div v-else class="opt-bg-preview">
              <img :src="fileProjBgImageUrl" class="opt-bg-preview-img" alt="image-preview" />
              <button
                class="opt-bg-preview-remove"
                type="button"
                :title="$t('options.slides.remove_image')"
                @click="removeFileProjBgImage"
              >
                <Icon :icon="ICONS.ACTIONS.CLOSE" size="15" />
              </button>
            </div>
          </div>
        </div>

        <div class="opt-row">
          <label class="opt-label" for="opt-fp-bg-position">
            {{ $t("options.background.position") }}
          </label>
          <select
            id="opt-fp-bg-position"
            class="opt-select"
            :value="fileProjBgPosition"
            @change="onFileProjBgPosition"
          >
            <option value="cover">{{ $t("options.slides.pos_cover") }}</option>
            <option value="contain">{{ $t("options.slides.pos_contain") }}</option>
            <option value="center">{{ $t("options.slides.pos_center") }}</option>
            <option value="stretch">{{ $t("options.slides.pos_stretch") }}</option>
            <option value="tile">{{ $t("options.slides.pos_tile") }}</option>
          </select>
        </div>
      </template>
    </section>

    <section id="opt-sec-utilities" class="opt-section">
      <h3 class="opt-section-title">
        <Icon :icon="ICONS.UI.TOOLS" size="18" />
        <span>{{ $t("options.utilities.title") }}</span>
      </h3>
      <div class="opt-row">
        <label class="opt-label" for="opt-utilities-monitor">
          {{ $t("options.utilities.open_at") }}
        </label>
        <MonitorSelect
          id="opt-utilities-monitor"
          :model-value="getUserData(KEYS.OPTIONS.UTILITIES_MONITOR, '') ?? ''"
          @update:model-value="saveUserData(KEYS.OPTIONS.UTILITIES_MONITOR, $event || null)"
        />
      </div>

      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="getUserData(KEYS.OPTIONS.UTILITIES_SHOW_RETURN, false)"
            @change="saveUserData(KEYS.OPTIONS.UTILITIES_SHOW_RETURN, $c($event))"
          />
          <span>{{ $t("options.utilities.show_return") }}</span>
        </label>
      </div>

      <div class="opt-row opt-row--field">
        <label class="opt-label" for="opt-utilities-font">
          {{ $t("options.utilities.font") }}
        </label>
        <SelectFont
          id="opt-utilities-font"
          :model-value="getUserData(KEYS.OPTIONS.UTILITIES_FONT, '')"
          @update:model-value="saveUserData(KEYS.OPTIONS.UTILITIES_FONT, $event)"
        />
      </div>
    </section>

    <section id="opt-sec-privacy" class="opt-section">
      <h3 class="opt-section-title">
        <Icon :icon="ICONS.UI.PRIVACY" size="18" />
        <span>{{ $t("options.privacy.title") }}</span>
      </h3>
      <div class="opt-row">
        <label class="opt-checkbox">
          <input
            type="checkbox"
            :checked="telemetryEnabled"
            @change="toggleTelemetry($c($event))"
          />
          <span>{{ $t("options.privacy.telemetry") }}</span>
        </label>
      </div>
      <p class="opt-hint">{{ $t("options.privacy.telemetry_hint") }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { LjButton } from "@/components/ui";
import Icon from "@/components/Icon.vue";
import { computed, type ComputedRef, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { pickImageData } from "@/helpers/FilePicker";
import { getSetting, saveSetting } from "@/helpers/SettingsStorage";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useI18n } from "vue-i18n";
import { useTheme } from "vuetify";
import { useDisplays } from "@/composables/useDisplays";
import WebDisplays from "@/helpers/projection/WebDisplays";
import MonitorSelect from "@/components/inputs/MonitorSelect.vue";
import SelectFont from "@/components/inputs/SelectFont.vue";
import MonitorShape from "@/components/MonitorShape.vue";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import Platform from "@/helpers/Platform";
import Telemetry from "@/helpers/Telemetry";
import { ICONS } from "@/config/Icons";
import { KEYS } from "@/constants/UserDataKeys";
import { MAIN_BACKGROUND_ID, Settings } from "@/types/Settings";
import { THEMES } from "@/config/Theme";
import { FONT } from "@/config/Fonts";

interface ThemeOption {
  id: string;
  label: string;
}

const isDesktop: ComputedRef<boolean> = computed(() => Platform.isDesktop as boolean);

// Seção inicial — permite abrir as Opções já rolando até uma seção
// (ex: botão "Configurações" da ribbon da Liturgia → "slides").
const props = defineProps<{ initialTab?: string }>();
const root = ref<HTMLElement | null>(null);

function scrollToSection(id?: string): void {
  if (!id) return;
  nextTick(() => {
    const el = root.value?.querySelector(`#opt-sec-${id}`);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  });
}

watch(() => props.initialTab, scrollToSection);

onMounted(() => {
  if (props.initialTab && props.initialTab !== "general") scrollToSection(props.initialTab);
});

const { t, locale } = useI18n();
const theme = useTheme();
const {
  displays,
  roles,
  screenAccess,
  requestScreenAccess,
  setRole,
  getFeatureRole,
  setFeatureRole,
  identify,
} = useDisplays();

/**
 * Estado da configuração "Tela cheia automática", deduzido da última tentativa
 * da janela de projeção — o navegador não deixa consultar essa permissão nem
 * pedi-la por prompt.
 */
const autoFullscreen = computed(() =>
  Platform.isDesktop ? "native" : WebDisplays.getAutoFullscreenState()
);

const themes: ComputedRef<ThemeOption[]> = computed(() =>
  Object.keys(theme.themes.value).map((id) => ({
    id,
    label: t(`options.general.themes.${id}`),
  }))
);

function getUserData<T = unknown>(key: string, defaultValue?: T): T {
  return $userdata.get<T>(key, defaultValue) as T;
}

/* ---- Helpers de evento para o template (TypeScript strict) ---- */
function $v(e: Event): string {
  return (e.target as HTMLInputElement | HTMLSelectElement).value;
}
function $c(e: Event): boolean {
  return (e.target as HTMLInputElement).checked;
}

/**
 * Uma linha por papel de monitor. Os módulos apontam para papéis, então basta
 * atribuir o monitor aqui uma vez para tudo seguir junto.
 */
const roleRows = computed(() =>
  roles.value.map((state) => ({
    role: state.role,
    label: t(`options.monitors.roles.${state.role}`),
    displayId: state.displayId,
    warning:
      state.status === "pending"
        ? t("options.monitors.roles.missing")
        : state.status === "ambiguous"
          ? t("options.monitors.roles.ambiguous")
          : state.status === "inferred"
            ? t("options.monitors.roles.inferred")
            : "",
  }))
);

// Proporção do monitor usado no preview de fundo: mostra a tela em que o
// fundo realmente vai aparecer, ou seja, a do papel "Projeção". Sem monitor
// atribuído, usa o display físico primário; por último, 16:9.
const previewMonitor = computed(() => {
  const projection = roles.value.find((r) => r.role === "projection");
  const selected = displays.value.find((d) => d.id === projection?.displayId);
  const primary = displays.value.find((d) => d.primary);
  const target = selected || primary;
  if (target?.bounds?.width && target?.bounds?.height) {
    return target.bounds;
  }
  return { width: 16, height: 9 };
});

const previewMonitorW: ComputedRef<number> = computed(() => previewMonitor.value.width);
const previewMonitorH: ComputedRef<number> = computed(() => previewMonitor.value.height);

function saveUserData(key: string, value: unknown): void {
  $userdata.set(key, value);
  if (key === KEYS.OPTIONS.FONT || key === KEYS.OPTIONS.PROJECTION_FONT) {
    Broadcast.send(BROADCAST_TYPE.SLIDE_FONT_CHANGED, {});
  } else if (key === KEYS.MODULES.BIBLE.FONT) {
    Broadcast.send(BROADCAST_TYPE.BIBLE_FORMAT_CHANGED, {});
  } else if (key === KEYS.OPTIONS.SLIDE.FONT) {
    Broadcast.send(BROADCAST_TYPE.SLIDE_FONT_CHANGED, {});
  } else if (key === KEYS.OPTIONS.UTILITIES_FONT) {
    Broadcast.send(BROADCAST_TYPE.SLIDE_FONT_CHANGED, {});
  }
}

/* ── Wallpaper via IndexedDB ── */

const bgColor = ref("#000033");
const bgPosition = ref("cover");
let wallpaperBlobUrl = ref("");
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function notifyViews(): void {
  Broadcast.send(BROADCAST_TYPE.WALLPAPER_UPDATE, {});
}

function onBgColorChange(e: Event): void {
  bgColor.value = (e.target as HTMLInputElement).value;
  scheduleSave();
}

function onBgPositionChange(e: Event): void {
  bgPosition.value = (e.target as HTMLSelectElement).value;
  scheduleSave();
}

async function scheduleSave(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const existing = (await getSetting<any>(MAIN_BACKGROUND_ID).catch(() => ({}))) || {};

    const settings: Settings = {
      id: MAIN_BACKGROUND_ID,
      ...existing,
      color: bgColor.value,
      position: bgPosition.value,
    };
    await saveSetting(settings);
    notifyViews();
  }, 300);
}

const currentBgImage = computed(() => wallpaperBlobUrl.value);

async function pickBgImage(): Promise<void> {
  const result = await pickImageData();
  if (!result) return;
  const { data, mime } = result;
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  if (wallpaperBlobUrl.value) URL.revokeObjectURL(wallpaperBlobUrl.value);
  wallpaperBlobUrl.value = url;
  await saveSetting({
    id: MAIN_BACKGROUND_ID,
    image: data,
    mime,
    color: bgColor.value,
    position: bgPosition.value,
  });
  notifyViews();
}

async function removeBgImage(): Promise<void> {
  if (wallpaperBlobUrl.value) {
    URL.revokeObjectURL(wallpaperBlobUrl.value);
    wallpaperBlobUrl.value = "";
  }
  const existing = (await getSetting<any>(MAIN_BACKGROUND_ID).catch(() => ({}))) || {};
  await saveSetting({ id: MAIN_BACKGROUND_ID, ...existing, image: null, mime: null });
  notifyViews();
}

onMounted(async () => {
  const s = await getSetting<any>(MAIN_BACKGROUND_ID).catch(() => null);
  if (s) {
    bgColor.value = s.color || "#000033";
    bgPosition.value = s.position || "cover";
    if (s.image) {
      const blob = new Blob([s.image], { type: s.mime || "image/png" });
      wallpaperBlobUrl.value = URL.createObjectURL(blob);
    }
  }
});

onBeforeUnmount(() => {
  if (wallpaperBlobUrl.value) URL.revokeObjectURL(wallpaperBlobUrl.value);
  if (fileProjBlobUrl) URL.revokeObjectURL(fileProjBlobUrl);
});

function restoreTextFormat(): void {
  saveUserData(KEYS.OPTIONS.SLIDE.TITLE_COLOR, "#ffd84d");
  saveUserData(KEYS.OPTIONS.SLIDE.TEXT_COLOR, "#ffffff");
  saveUserData(KEYS.OPTIONS.SLIDE.REPEAT_COLOR, "#bbbbbb");
  saveUserData(KEYS.OPTIONS.SLIDE.AUX_COLOR, "#cccccc");
  saveUserData(KEYS.OPTIONS.SLIDE.TITLE_SIZE, 18);
  saveUserData(KEYS.OPTIONS.SLIDE.BODY_SIZE, 14);
  saveUserData(KEYS.OPTIONS.SLIDE.AUX_SIZE, 10);
  saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_TRANSPARENT, false);
  saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR_ENABLED, false);
  saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR, 12);
  saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_ENABLED, false);
  saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_COLOR, "#ffffff");
  saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_WIDTH, 2);
  saveUserData(KEYS.OPTIONS.SLIDE.SHADOW_ENABLED, false);
  saveUserData(KEYS.OPTIONS.SLIDE.SHADOW_COLOR, "#000000");
  saveUserData(KEYS.OPTIONS.SLIDE.SHADOW_BLUR, 12);
  saveUserData(KEYS.OPTIONS.SLIDE.SHADOW_OFFSET_X, 0);
  saveUserData(KEYS.OPTIONS.SLIDE.SHADOW_OFFSET_Y, 2);
}

const mediaFadeAudio: ComputedRef<boolean> = computed(
  () => $userdata.get<boolean>(KEYS.MODULES.MEDIA.FADE_AUDIO, false)!!
);
const mediaLazyLoad: ComputedRef<boolean> = computed(
  () => $userdata.get<boolean>(KEYS.MODULES.MEDIA.LAZY_LOAD, true)!!
);

const videoProjFullscreen: ComputedRef<boolean> = computed(
  () => $userdata.get<boolean>(KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.FULLSCREEN, true)!!
);
const videoProjAlwaysOnTop: ComputedRef<boolean> = computed(
  () => $userdata.get<boolean>(KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.ALWAYS_ON_TOP, true)!!
);
const vidProjShowReturn: ComputedRef<boolean> = computed(
  () => $userdata.get<boolean>(KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.SHOW_RETURN, false)!!
);

const bibleReturnEnabled: ComputedRef<boolean> = computed(
  () => $userdata.get<boolean>(KEYS.MODULES.BIBLE.SHOW_RETURN, false)!!
);

const fileProjFullscreen: ComputedRef<boolean> = computed(
  () => $userdata.get<boolean>(KEYS.OPTIONS.FILE_PROJECTION.FULLSCREEN, true)!!
);
const fileProjAlwaysOnTop: ComputedRef<boolean> = computed(
  () => $userdata.get<boolean>(KEYS.OPTIONS.FILE_PROJECTION.ALWAYS_ON_TOP, true)!!
);
const fileProjShowReturn: ComputedRef<boolean> = computed(
  () => $userdata.get<boolean>(KEYS.OPTIONS.FILE_PROJECTION.SHOW_RETURN, false)!!
);

function setMedia(key: string, value: any): void {
  $userdata.set(`modules.media.${key}`, value);
}

const fileProjectionFade: ComputedRef<boolean> = computed(
  () => $userdata.get<boolean>(KEYS.OPTIONS.FILE_PROJECTION.FADE, true)!!
);
const fileProjectionFadeDuration: ComputedRef<number> = computed(
  () => $userdata.get(KEYS.OPTIONS.FILE_PROJECTION.FADE_DURATION, 500)!!
);

function setFileProj(key: string, value: any): void {
  $userdata.set(`options.file_projection.${key}`, value);
}

/* ── File Projection Background ── */

const FP_STORAGE_ID = "file_projection_background";

const fileProjBgEnabled: ComputedRef<boolean> = computed(
  () => $userdata.get(KEYS.OPTIONS.FILE_PROJECTION.BACKGROUND_ENABLED, false) as boolean
);

const fileProjBgColor = ref("#000033");
const fileProjBgPosition = ref("cover");
const fileProjBgImageUrl = ref("");
let fileProjBlobUrl: string | null = null;

function notifyFileProjViews(): void {
  Broadcast.send(BROADCAST_TYPE.FILE_PROJECTION_BG_UPDATE, {});
}

async function saveFileProjBg(): Promise<void> {
  const existing = (await getSetting<any>(FP_STORAGE_ID).catch(() => ({}))) || {};
  await saveSetting({
    id: FP_STORAGE_ID,
    ...existing,
    color: fileProjBgColor.value,
    position: fileProjBgPosition.value,
  });
  notifyFileProjViews();
}

async function loadFileProjBg(): Promise<void> {
  const s = await getSetting<any>(FP_STORAGE_ID).catch(() => null);
  if (s) {
    fileProjBgColor.value = s.color || "#000033";
    fileProjBgPosition.value = s.position || "cover";
    if (s.image) {
      if (fileProjBlobUrl) URL.revokeObjectURL(fileProjBlobUrl);
      const blob = new Blob([s.image], { type: s.mime || "image/png" });
      fileProjBlobUrl = URL.createObjectURL(blob);
      fileProjBgImageUrl.value = fileProjBlobUrl;
    } else {
      if (fileProjBlobUrl) {
        URL.revokeObjectURL(fileProjBlobUrl);
        fileProjBlobUrl = null;
      }
      fileProjBgImageUrl.value = "";
    }
  } else {
    fileProjBgColor.value = "#000033";
    fileProjBgPosition.value = "cover";
    fileProjBgImageUrl.value = "";
  }
}

function toggleFileProjBg(e: Event): void {
  const checked = (e.target as HTMLInputElement).checked;
  $userdata.set("options.file_projection.background_enabled", checked);
  if (checked) {
    loadFileProjBg();
  } else {
    notifyFileProjViews();
  }
}

function onFileProjBgColor(e: Event): void {
  fileProjBgColor.value = (e.target as HTMLInputElement).value;
  saveFileProjBg();
}

function onFileProjBgPosition(e: Event): void {
  fileProjBgPosition.value = (e.target as HTMLSelectElement).value;
  saveFileProjBg();
}

async function pickFileProjBgImage(): Promise<void> {
  const r = await pickImageData();
  if (!r) return;
  const blob = new Blob([r.data], { type: r.mime });
  if (fileProjBlobUrl) URL.revokeObjectURL(fileProjBlobUrl);
  fileProjBlobUrl = URL.createObjectURL(blob);
  fileProjBgImageUrl.value = fileProjBlobUrl;
  await saveSetting({
    id: FP_STORAGE_ID,
    image: r.data,
    mime: r.mime,
    color: fileProjBgColor.value,
    position: fileProjBgPosition.value,
  });
  notifyFileProjViews();
}

async function removeFileProjBgImage(): Promise<void> {
  if (fileProjBlobUrl) {
    URL.revokeObjectURL(fileProjBlobUrl);
    fileProjBlobUrl = null;
  }
  fileProjBgImageUrl.value = "";
  const existing = (await getSetting<any>(FP_STORAGE_ID).catch(() => ({}))) || {};
  await saveSetting({ id: FP_STORAGE_ID, ...existing, image: null, mime: null });
  notifyFileProjViews();
}

/**
 * Papel escolhido para cada módulo. Carregado sob demanda porque a consulta
 * atravessa o IPC.
 */
const featureRoles = ref<Record<string, string>>({});

function setPref(feature: string, role: string): void {
  featureRoles.value = { ...featureRoles.value, [feature]: role };
  setFeatureRole(feature, role || null);
}

function getPref(feature: string): string {
  if (featureRoles.value[feature] === undefined) {
    featureRoles.value[feature] = "";
    getFeatureRole(feature).then((role) => {
      featureRoles.value = { ...featureRoles.value, [feature]: role ?? "" };
    });
  }
  return featureRoles.value[feature];
}

function changeTheme(selectedTheme: string): void {
  saveUserData(KEYS.OPTIONS.THEME, selectedTheme);
  theme.change(selectedTheme);
  $userdata.set("theme", selectedTheme);
  document.documentElement.dataset.theme = selectedTheme;
  const isDark = selectedTheme === "dark";
  $appdata.set("is_dark", isDark);
  if (!isDark) $userdata.set("theme_last_light", selectedTheme);
}

function changeLanguage(lang: string): void {
  saveUserData(KEYS.OPTIONS.LANGUAGE, lang);
  locale.value = lang;
  $userdata.set("language", lang);
}

const telemetryEnabled = ref(Telemetry.isEnabled());

function toggleTelemetry(enabled: boolean): void {
  telemetryEnabled.value = enabled;
  Telemetry.setEnabled(enabled);
}

async function toggleStartWithOS(enabled: boolean): Promise<void> {
  saveUserData(KEYS.OPTIONS.START_WITH_OS, enabled);
  const api = Platform?.appLogin as { set: (enabled: boolean) => Promise<unknown> } | null;
  if (api?.set) {
    try {
      await api.set(enabled);
    } catch (e) {
      console.warn("[AppMenuOpcoes] setLoginItem falhou:", e);
    }
  }
}

onMounted(async () => {
  const api = Platform?.appLogin as { get: () => Promise<{ openAtLogin: boolean }> } | null;
  if (api?.get) {
    try {
      const cur = await api.get();
      if (cur && typeof cur.openAtLogin === "boolean") {
        $userdata.set(KEYS.OPTIONS.START_WITH_OS, cur.openAtLogin);
      }
    } catch {
      /* ignore */
    }
  }
});
</script>

<style scoped>
/* Imagem de fundo: campos e pré-visualização seguem as mesmas colunas da
   seção, para o monitor não flutuar entre elas. */
.opt-bg {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  align-items: start;
  column-gap: var(--lj-space-8);
}

.opt-bg-fields {
  min-width: 0;
}

.opt-bg-fields .opt-row:last-child {
  margin-bottom: 0;
}

.opt-bg .opt-bg-preview-wrap {
  justify-content: flex-start;
  width: auto;
  height: auto;
  margin-top: 0;
}
</style>
