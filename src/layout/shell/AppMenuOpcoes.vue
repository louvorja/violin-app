<template>
  <div ref="root" class="opt">
    <section id="opt-sec-general" class="opt-section">
      <h3 class="opt-section-title">
        <Icon :icon="ICONS.UI.OPTIONS" size="18" />
        <span>{{ $t("options.general.title") }}</span>
      </h3>
      <div class="opt-row">
        <label class="opt-label" for="opt-theme">{{ $t("options.general.theme") }}</label>
        <LjSelect
          id="opt-theme"
          :items="themes"
          item-value="id"
          item-label="label"
          :model-value="getUserData(KEYS.OPTIONS.THEME, COLOR_THEMES.DEFAULT)"
          @update:model-value="changeTheme(String($event))"
        />
      </div>

      <div class="opt-row">
        <label class="opt-label" for="opt-language">{{ $t("options.general.language") }}</label>
        <LjSelect
          id="opt-language"
          :items="opcoesIdioma"
          :model-value="getUserData(KEYS.OPTIONS.LANGUAGE, 'pt')"
          @update:model-value="changeLanguage(String($event))"
        />
      </div>

      <div class="opt-row">
        <label class="opt-label" for="opt-ui-style">{{ $t("options.general.ui_style") }}</label>
        <LjSelect
          id="opt-ui-style"
          :items="opcoesEstiloUi"
          :model-value="getUserData(KEYS.OPTIONS.UI_STYLE, THEMES.CLASSIC)"
          @update:model-value="saveUserData(KEYS.OPTIONS.UI_STYLE, $event)"
        />
      </div>

      <div class="opt-row">
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

      <div class="opt-row">
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
          <div class="opt-row">
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

          <div class="opt-row">
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

          <div class="opt-row">
            <label class="opt-label" for="opt-bg-position">
              {{ $t("options.background.position") }}
            </label>
            <LjSelect
              id="opt-bg-position"
              :items="opcoesPosicaoFundo"
              :model-value="bgPosition"
              @update:model-value="onBgPositionChange"
            />
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
              <img v-if="currentBgImage" :src="currentBgImage" class="opt-bg-preview-img" alt="" />
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

      <template v-else>
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

        <div class="opt-actions">
          <button type="button" class="opt-btn" @click="identify(5000)">
            {{ $t("options.monitors.identify") }}
          </button>
        </div>

        <!-- Tela cheia automática: o site não pode pedir essa permissão nem
             consultá-la; só o usuário libera. Mostramos o estado deduzido da
             última projeção e como resolver. -->
        <div v-if="autoFullscreen !== 'native'" class="opt-row opt-row--col">
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
          <LjSelect
            :id="`opt-monitor-role-${role.role}`"
            :items="opcoesMonitor"
            :model-value="role.displayId ?? ''"
            @update:model-value="setRole(role.role, $event === '' ? null : String($event))"
          />
          <span v-if="role.warning" class="opt-monitor-warning">{{ role.warning }}</span>
        </div>
      </template>
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

      <div class="opt-row">
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
        <LjSelect
          id="opt-slides-align"
          :items="opcoesAlinhamento"
          :model-value="getUserData(KEYS.OPTIONS.SLIDE.TEXT_ALIGN, 'center')"
          @update:model-value="saveUserData(KEYS.OPTIONS.SLIDE.TEXT_ALIGN, $event)"
        />
      </div>
      <div class="opt-row">
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
      <div v-if="getUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR_ENABLED, false)" class="opt-row">
        <label class="opt-label" for="opt-text-bg-blur">
          {{ $t("options.slides.text_bg_blur") }}
        </label>
        <input
          id="opt-text-bg-blur"
          type="range"
          min="0"
          max="30"
          step="1"
          class="opt-range"
          :value="getUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR, 12)"
          @input="saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR, Number($v($event)))"
        />
        <span class="opt-range-val">{{ getUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR, 12) }}px</span>
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
        <!-- Banda A — os quatro elementos do slide (esquerda) e os três efeitos da caixa (direita) -->
        <div class="fmt-top">
          <table class="fmt-el">
            <thead>
              <tr>
                <td class="fmt-el__corner"></td>
                <th scope="col">{{ $t("options.slides.fmt_el_title") }}</th>
                <th scope="col">{{ $t("options.slides.fmt_el_lyric") }}</th>
                <th scope="col" :title="$t('options.slides.fmt_el_repeat_hint')">
                  {{ $t("options.slides.fmt_el_repeat") }}
                </th>
                <th scope="col">{{ $t("options.slides.fmt_el_aux") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{{ $t("options.slides.fmt_attr_color") }}</th>
                <td>
                  <input
                    type="color"
                    class="opt-color"
                    :aria-label="`${$t('options.slides.fmt_el_title')} — ${$t('options.slides.fmt_attr_color')}`"
                    :value="
                      getUserData(KEYS.OPTIONS.SLIDE.TITLE_COLOR, SLIDE_STYLE_DEFAULT.color_cover)
                    "
                    @input="saveUserData(KEYS.OPTIONS.SLIDE.TITLE_COLOR, $v($event))"
                  />
                </td>
                <td>
                  <input
                    type="color"
                    class="opt-color"
                    :aria-label="`${$t('options.slides.fmt_el_lyric')} — ${$t('options.slides.fmt_attr_color')}`"
                    :value="
                      getUserData(KEYS.OPTIONS.SLIDE.TEXT_COLOR, SLIDE_STYLE_DEFAULT.color_lyric)
                    "
                    @input="saveUserData(KEYS.OPTIONS.SLIDE.TEXT_COLOR, $v($event))"
                  />
                </td>
                <td>
                  <input
                    type="color"
                    class="opt-color"
                    :aria-label="`${$t('options.slides.fmt_el_repeat')} — ${$t('options.slides.fmt_attr_color')}`"
                    :value="
                      getUserData(KEYS.OPTIONS.SLIDE.REPEAT_COLOR, SLIDE_STYLE_DEFAULT.color_repeat)
                    "
                    @input="saveUserData(KEYS.OPTIONS.SLIDE.REPEAT_COLOR, $v($event))"
                  />
                </td>
                <td>
                  <input
                    type="color"
                    class="opt-color"
                    :aria-label="`${$t('options.slides.fmt_el_aux')} — ${$t('options.slides.fmt_attr_color')}`"
                    :value="
                      getUserData(KEYS.OPTIONS.SLIDE.AUX_COLOR, SLIDE_STYLE_DEFAULT.color_aux)
                    "
                    @input="saveUserData(KEYS.OPTIONS.SLIDE.AUX_COLOR, $v($event))"
                  />
                </td>
              </tr>
              <tr>
                <th scope="row" :title="$t('options.slides.fmt_attr_size_hint')">
                  {{ $t("options.slides.fmt_attr_size") }}
                </th>
                <td>
                  <input
                    type="number"
                    min="6"
                    max="60"
                    class="opt-input opt-input--num"
                    :aria-label="`${$t('options.slides.fmt_el_title')} — ${$t('options.slides.fmt_attr_size')}`"
                    :value="
                      getUserData(
                        KEYS.OPTIONS.SLIDE.TITLE_SIZE,
                        SLIDE_STYLE_DEFAULT.font_size_cover
                      )
                    "
                    @input="
                      saveUserData(
                        KEYS.OPTIONS.SLIDE.TITLE_SIZE,
                        Number($v($event)) || SLIDE_STYLE_DEFAULT.font_size_cover
                      )
                    "
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="6"
                    max="60"
                    class="opt-input opt-input--num"
                    :aria-label="`${$t('options.slides.fmt_el_lyric')} — ${$t('options.slides.fmt_attr_size')}`"
                    :value="
                      getUserData(KEYS.OPTIONS.SLIDE.BODY_SIZE, SLIDE_STYLE_DEFAULT.font_size_lyric)
                    "
                    @input="
                      saveUserData(
                        KEYS.OPTIONS.SLIDE.BODY_SIZE,
                        Number($v($event)) || SLIDE_STYLE_DEFAULT.font_size_lyric
                      )
                    "
                  />
                </td>
                <td class="fmt-el__inherit" :title="$t('options.slides.fmt_size_from_lyric_hint')">
                  {{ $t("options.slides.fmt_size_from_lyric") }}
                </td>
                <td>
                  <input
                    type="number"
                    min="6"
                    max="60"
                    class="opt-input opt-input--num"
                    :aria-label="`${$t('options.slides.fmt_el_aux')} — ${$t('options.slides.fmt_attr_size')}`"
                    :value="
                      getUserData(KEYS.OPTIONS.SLIDE.AUX_SIZE, SLIDE_STYLE_DEFAULT.font_size_aux)
                    "
                    @input="
                      saveUserData(
                        KEYS.OPTIONS.SLIDE.AUX_SIZE,
                        Number($v($event)) || SLIDE_STYLE_DEFAULT.font_size_aux
                      )
                    "
                  />
                </td>
              </tr>
            </tbody>
          </table>

          <div class="fmt-fx">
            <label class="opt-checkbox">
              <input
                type="checkbox"
                :checked="getUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_TRANSPARENT, false)"
                @change="saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_TRANSPARENT, $c($event))"
              />
              <span>{{ $t("options.slides.text_bg_transparent") }}</span>
            </label>

            <label class="opt-checkbox">
              <input
                type="checkbox"
                :checked="getUserData(KEYS.OPTIONS.SLIDE.SHADOW_ENABLED, false)"
                @change="saveUserData(KEYS.OPTIONS.SLIDE.SHADOW_ENABLED, $c($event))"
              />
              <span>{{ $t("options.slides.shadow_enabled") }}</span>
            </label>

            <label class="opt-checkbox">
              <input
                type="checkbox"
                :checked="getUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_ENABLED, false)"
                @change="saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_ENABLED, $c($event))"
              />
              <span>{{ $t("options.slides.text_border_enabled") }}</span>
            </label>
          </div>
        </div>

        <!-- Banda B — parâmetros dos efeitos ligados. Cada linha nasce embaixo de
             tudo, então nenhum controle existente muda de lugar quando um efeito é
             ligado; a primeira etiqueta da linha ("Cor Sombra:") é quem a nomeia. -->
        <div v-if="getUserData(KEYS.OPTIONS.SLIDE.SHADOW_ENABLED, false)" class="fmt-params">
          <label class="fmt-field">
            <span class="opt-format-label">{{ $t("options.slides.shadow_color") }}</span>
            <input
              type="color"
              class="opt-color"
              :value="
                getUserData(KEYS.OPTIONS.SLIDE.SHADOW_COLOR, SLIDE_STYLE_DEFAULT.shadow_color)
              "
              @input="saveUserData(KEYS.OPTIONS.SLIDE.SHADOW_COLOR, $v($event))"
            />
          </label>
          <label class="fmt-field">
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
          <label class="fmt-field">
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
          <label class="fmt-field">
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

        <div v-if="getUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_ENABLED, false)" class="fmt-params">
          <label class="fmt-field">
            <span class="opt-format-label">{{ $t("options.slides.text_border_color") }}</span>
            <input
              type="color"
              class="opt-color"
              :value="
                getUserData(
                  KEYS.OPTIONS.SLIDE.TEXT_BORDER_COLOR,
                  SLIDE_STYLE_DEFAULT.text_border_color
                )
              "
              @input="saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_COLOR, $v($event))"
            />
          </label>
          <label class="fmt-field">
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
          <div class="opt-format-field">
            <label class="opt-format-label" for="opt-return-text-case">
              {{ $t("options.slides.text_case") }}
            </label>
            <LjSelect
              id="opt-return-text-case"
              :items="opcoesCaixaTexto"
              :model-value="textCaseAtual"
              @update:model-value="saveUserData(KEYS.OPTIONS.SLIDE.RETURN_TEXT_CASE, $event)"
            />
          </div>
          <label class="opt-format-field">
            <span class="opt-format-label">{{ $t("options.slides.text_size") }}</span>
            <input
              type="number"
              min="3"
              max="15"
              class="opt-input opt-input--num"
              :value="getUserData(KEYS.OPTIONS.SLIDE.FONT_SIZE_NEXT, 5)"
              @input="saveUserData(KEYS.OPTIONS.SLIDE.FONT_SIZE_NEXT, Number($v($event)) || 5)"
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
          <div class="opt-format-field">
            <label class="opt-format-label" for="opt-slides-bg-position">
              {{ $t("options.slides.bg_position") }}
            </label>
            <LjSelect
              id="opt-slides-bg-position"
              :items="opcoesPosicaoFundo"
              :model-value="getUserData(KEYS.OPTIONS.SLIDE.BG_POSITION, 'center')"
              @update:model-value="saveUserData(KEYS.OPTIONS.SLIDE.BG_POSITION, $event)"
            />
          </div>
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
        <LjSelect
          id="opt-youtube-action"
          :items="opcoesAcaoYoutube"
          :model-value="getUserData(KEYS.OPTIONS.YOUTUBE_ACTION, 'video')"
          @update:model-value="saveUserData(KEYS.OPTIONS.YOUTUBE_ACTION, $event)"
        />
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
          {{ $t("options.videos.open_return_at") }}
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
            max="3000"
            step="100"
            class="opt-input opt-input--num"
            style="width: 80px"
            :aria-label="$t('options.file_projection.fade_duration')"
            :value="fileProjectionFadeDuration"
            @input="setFileProj('fade_duration', duracaoDeFade($v($event)))"
          />
          <span class="opt-unit">ms</span>
        </div>
      </div>

      <div class="opt-divider" />

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
              <img :src="fileProjBgImageUrl" class="opt-bg-preview-img" alt="" />
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
          <LjSelect
            id="opt-fp-bg-position"
            :items="opcoesPosicaoFundo"
            :model-value="fileProjBgPosition"
            @update:model-value="onFileProjBgPosition"
          />
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

      <div class="opt-row">
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
import { LjButton, LjSelect } from "@/components/ui";
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
import { THEMES, COLOR_THEMES } from "@/config/Theme";
import { SLIDE_STYLE_DEFAULT } from "@/config/SlideStyle";
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

// Listas dos combobox. Sempre `computed`: os rótulos passam pelo i18n e têm de
// reagir à troca de idioma, que acontece nesta mesma tela.
const opcoesIdioma = computed(() => [
  { value: "pt", label: "Português" },
  { value: "es", label: "Español" },
]);

const opcoesEstiloUi = computed(() =>
  Object.values(THEMES).map((estilo) => ({
    value: estilo,
    // O valor gravado continua sendo o enum minúsculo — RibbonBar compara com
    // THEMES.VIOLIN. Só o rótulo passou a vir do i18n, em vez do enum cru em
    // caixa alta.
    label: t(`options.general.ui_styles.${estilo}`),
  }))
);

const opcoesPosicaoFundo = computed(() => [
  { value: "cover", label: t("options.slides.pos_cover") },
  { value: "contain", label: t("options.slides.pos_contain") },
  { value: "center", label: t("options.slides.pos_center") },
  { value: "stretch", label: t("options.slides.pos_stretch") },
  { value: "tile", label: t("options.slides.pos_tile") },
]);

const opcoesAlinhamento = computed(() => [
  { value: "top", label: t("options.slides.align_top") },
  { value: "center", label: t("options.slides.align_center") },
  { value: "bottom", label: t("options.slides.align_bottom") },
]);

const opcoesCaixaTexto = computed(() => [
  { value: "none", label: t("options.slides.case_normal") },
  { value: "capitalize", label: t("options.slides.case_capitalize") },
  { value: "uppercase", label: t("options.slides.case_uppercase") },
]);

const opcoesAcaoYoutube = computed(() => [
  { value: "video", label: t("options.videos.action_video") },
  { value: "link", label: t("options.videos.action_link") },
]);

const opcoesMonitor = computed(() => [
  { value: "", label: t("options.slides.none") },
  ...displays.value.map((d) => ({ value: String(d.id), label: d.label || `Monitor ${d.id}` })),
]);

// "normal" é valor legado: não existe em CSS text-transform, e a projeção
// passou a traduzi-lo para "none". O select precisa da mesma tradução, senão
// quem já tinha "normal" salvo abre as Opções com o campo em branco.
const textCaseAtual = computed(() => {
  const v = getUserData<string>(KEYS.OPTIONS.SLIDE.RETURN_TEXT_CASE, "uppercase");
  return v === "normal" ? "none" : v;
});

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

function onBgPositionChange(valor: string | number | null): void {
  bgPosition.value = String(valor ?? "");
  scheduleSave();
}

async function saveMainBg(): Promise<void> {
  const existing = (await getSetting<any>(MAIN_BACKGROUND_ID).catch(() => ({}))) || {};

  const settings: Settings = {
    id: MAIN_BACKGROUND_ID,
    ...existing,
    color: bgColor.value,
    position: bgPosition.value,
  };
  await saveSetting(settings);
  notifyViews();
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveMainBg();
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
  // O fundo da projeção de arquivos só era lido ao ligar o interruptor. Quem
  // abria as Opções com ele já ligado via os defaults, e qualquer edição
  // gravava por cima da configuração real.
  await loadFileProjBg();
});

onBeforeUnmount(() => {
  // Descarrega o que estiver pendente: fechar o painel logo depois de soltar o
  // mouse cancelaria a gravação sem ela nunca ter acontecido.
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    void saveMainBg();
  }
  if (fpSaveTimer) {
    clearTimeout(fpSaveTimer);
    fpSaveTimer = null;
    void saveFileProjBg();
  }
  if (wallpaperBlobUrl.value) URL.revokeObjectURL(wallpaperBlobUrl.value);
  if (fileProjBlobUrl) URL.revokeObjectURL(fileProjBlobUrl);
});

function restoreTextFormat(): void {
  // Os literais daqui divergiam do que a projeção usa sem configuração —
  // "Restaurar" devolvia um estado que nunca foi o padrão de ninguém.
  saveUserData(KEYS.OPTIONS.SLIDE.TITLE_COLOR, SLIDE_STYLE_DEFAULT.color_cover);
  saveUserData(KEYS.OPTIONS.SLIDE.TEXT_COLOR, SLIDE_STYLE_DEFAULT.color_lyric);
  saveUserData(KEYS.OPTIONS.SLIDE.REPEAT_COLOR, SLIDE_STYLE_DEFAULT.color_repeat);
  saveUserData(KEYS.OPTIONS.SLIDE.AUX_COLOR, SLIDE_STYLE_DEFAULT.color_aux);
  saveUserData(KEYS.OPTIONS.SLIDE.TITLE_SIZE, SLIDE_STYLE_DEFAULT.font_size_cover);
  saveUserData(KEYS.OPTIONS.SLIDE.BODY_SIZE, SLIDE_STYLE_DEFAULT.font_size_lyric);
  saveUserData(KEYS.OPTIONS.SLIDE.AUX_SIZE, SLIDE_STYLE_DEFAULT.font_size_aux);
  saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_TRANSPARENT, false);
  saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR_ENABLED, false);
  saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR, SLIDE_STYLE_DEFAULT.text_bg_blur);
  saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_ENABLED, false);
  saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_COLOR, SLIDE_STYLE_DEFAULT.text_border_color);
  saveUserData(KEYS.OPTIONS.SLIDE.TEXT_BORDER_WIDTH, 2);
  saveUserData(KEYS.OPTIONS.SLIDE.SHADOW_ENABLED, false);
  saveUserData(KEYS.OPTIONS.SLIDE.SHADOW_COLOR, SLIDE_STYLE_DEFAULT.shadow_color);
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

/**
 * `Number(x) || 500` engolia o zero: quem digitava 0 para desligar o fade
 * recebia 500ms de volta. E a caixa aceitava até 5000 enquanto o slider ao lado
 * para em 3000, então os dois controles do mesmo valor discordavam.
 */
function duracaoDeFade(bruto: string): number {
  const n = Number(bruto);
  if (!Number.isFinite(n)) return 500;
  return Math.min(3000, Math.max(0, n));
}

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

async function toggleFileProjBg(e: Event): Promise<void> {
  const checked = (e.target as HTMLInputElement).checked;
  $userdata.set(KEYS.OPTIONS.FILE_PROJECTION.BACKGROUND_ENABLED, checked);
  if (checked) {
    await loadFileProjBg();
    // saveFileProjBg também cria o registro de quem nunca configurou — sem ele
    // o broadcast chega e a projeção não acha o que aplicar.
    await saveFileProjBg();
  } else {
    notifyFileProjViews();
  }
}

/**
 * Timer PRÓPRIO, separado do `saveTimer` do fundo principal.
 *
 * São dois registros e dois broadcasts distintos; compartilhar o timer faria a
 * edição de um cancelar (clearTimeout) a gravação pendente do outro.
 */
let fpSaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFileProjSave(): void {
  if (fpSaveTimer) clearTimeout(fpSaveTimer);
  fpSaveTimer = setTimeout(() => {
    fpSaveTimer = null;
    void saveFileProjBg();
  }, 300);
}

function onFileProjBgColor(e: Event): void {
  fileProjBgColor.value = (e.target as HTMLInputElement).value;
  // Sem o debounce, arrastar no seletor de cor gravava no IndexedDB e disparava
  // um broadcast por evento de movimento — com a projeção aberta ao vivo.
  scheduleFileProjSave();
}

function onFileProjBgPosition(valor: string | number | null): void {
  fileProjBgPosition.value = String(valor ?? "");
  scheduleFileProjSave();
}

async function pickFileProjBgImage(): Promise<void> {
  const r = await pickImageData();
  if (!r) return;
  const blob = new Blob([r.data], { type: r.mime });
  if (fileProjBlobUrl) URL.revokeObjectURL(fileProjBlobUrl);
  fileProjBlobUrl = URL.createObjectURL(blob);
  fileProjBgImageUrl.value = fileProjBlobUrl;
  const existing = (await getSetting<any>(FP_STORAGE_ID).catch(() => ({}))) || {};
  await saveSetting({
    id: FP_STORAGE_ID,
    ...existing,
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
  document.documentElement.dataset.theme = selectedTheme;
  const isDark = selectedTheme === "dark";
  $appdata.set(KEYS.SHELL.IS_DARK, isDark);
  if (!isDark) $userdata.set(KEYS.OPTIONS.THEME_LAST_LIGHT, selectedTheme);
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
/* === Formatação de texto personalizada ==================================
   Substitui .opt-format-grid (3fr 4fr 5fr), onde sombra e borda eram colunas
   irmãs: a linha herdava a altura da coluna mais alta, então o efeito
   desligado reservava o vão inteiro do vizinho ligado.

   Banda A — a tabela dos quatro elementos do slide ao lado dos três
   interruptores de efeito. Altura fixa (~81px), imune aos toggles.
   Banda B — os parâmetros do efeito ligado, em linha cheia, abaixo de tudo. */
.fmt-top {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: var(--lj-space-7);
}

/* --- Banda A · elementos do slide --------------------------------------
   A propriedade é dita uma vez na coluna da esquerda e o elemento uma vez no
   cabeçalho; nenhum rótulo carrega as duas informações (era daí que vinham os
   dois "Texto:"). Cor e tamanho do mesmo elemento ficam na mesma coluna, um
   debaixo do outro. <th scope> dá a leitura em modo de navegação; o nome
   acessível de cada campo vem do aria-label composto no template, porque
   scope não nomeia controle de formulário. */
.fmt-el {
  border-collapse: collapse;
  font-size: var(--lj-text-base);
}

.fmt-el th,
.fmt-el td {
  padding: 0;
  text-align: center;
  vertical-align: middle;
  white-space: nowrap;
}

/* 72px = o campo numérico (64px) com folga para "Repetición" a 12px. Os
   swatches de 38px ficam centrados na mesma trilha: as quatro cores leem
   como a paleta do slide, e cada uma tem o nome do elemento em cima. */
.fmt-el thead th,
.fmt-el tbody td {
  width: 72px;
  padding-left: var(--lj-space-4);
}

.fmt-el thead th {
  padding-bottom: var(--lj-space-2);
  border-bottom: 1px solid var(--lj-surface-border);
  font-weight: var(--lj-weight-medium);
  color: var(--lj-text-muted);
}

/* Cor de texto cheia a 12px: é esta coluna que desambigua os sete campos, e
   não pode ser o texto menos legível do bloco. */
.fmt-el tbody th {
  padding-right: var(--lj-space-4);
  text-align: left;
  font-weight: var(--lj-weight-medium);
  color: var(--lj-text);
}

.fmt-el tbody tr:first-child th,
.fmt-el tbody tr:first-child td {
  padding-top: var(--lj-space-3);
}

.fmt-el tbody tr + tr th,
.fmt-el tbody tr + tr td {
  padding-top: var(--lj-space-2);
}

/* A repetição não tem tamanho próprio: useSlideStyle só sobrescreve a cor, e
   o trecho repetido é desenhado com o tamanho da Letra. A célula fica
   ocupada e diz de onde o valor vem, em vez de sumir da coluna. */
.fmt-el__inherit {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-subtle);
  cursor: help;
}

/* --- Banda A · interruptores de efeito ---------------------------------
   Empilhados: os três ficam sempre na mesma posição, e nenhum deles é
   empurrado quando outro é ligado. */
.fmt-fx {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
}

/* --- Banda B · parâmetros do efeito ligado -----------------------------
   Linha cheia, abaixo dos interruptores: ligar um efeito não desloca nenhum
   controle existente — só o botão Restaurar desce. O recuo marca a
   subordinação e a etiqueta do primeiro campo ("Cor Sombra:", "Cor da
   borda:") nomeia a linha, sem repetir o texto do interruptor. */
.fmt-params {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--lj-space-3) var(--lj-space-5);
  min-height: var(--lj-ui-h-md);
  padding-left: var(--lj-space-6);
}

.fmt-field {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
}

/* O .opt-range global é flex:1 com piso de 80px. Numa linha cheia de ~880px o
   slider solto da Espessura se esticaria por meia tela para uma faixa de 1 a
   10; com pista fixa a linha termina onde o conteúdo termina. */
.fmt-params .opt-range {
  flex: 0 0 110px;
  min-width: 0;
}

.opt-divider {
  height: 1px;
  margin: var(--lj-space-5) 0;
  background: var(--lj-surface-border);
}

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
</style>
