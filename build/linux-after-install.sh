#!/bin/bash

# DEB/RPM executam o post-install como root. Não use HOME nem a conta que
# invocou sudo: perfil e vídeos são criados pelo app na conta de cada usuário.
if [ "$(id -u)" != 0 ]; then
    echo "LouvorJA: o hook do pacote precisa ser executado como root." >&2
    exit 1
fi

louvorja_provision_shared_collection() {
    local base='/var/lib/louvorja-violin'
    local media="$base/acervo"
    local directory owner permissions staging

    # Não atravesse links nem crie filhos numa pasta controlada por outra conta.
    # Pastas existentes nunca recebem chmod/chown/setfacl recursivo ou corretivo.
    for directory in '/var' '/var/lib' "$base"; do
        if [ -L "$directory" ]; then return 1; fi
        if [ ! -e "$directory" ]; then
            [ "$directory" = "$base" ] || return 1
            mkdir -m 0755 -- "$base" || return 1
        fi
        [ -d "$directory" ] || return 1
        owner=$(stat -c '%u' -- "$directory") || return 1
        permissions=$(stat -c '%a' -- "$directory") || return 1
        [ "$owner" = 0 ] || return 1
        case "$permissions" in ''|*[!0-7]*) return 1 ;; esac
        [ "$((0$permissions & 0022))" -eq 0 ] || return 1
    done

    # Reinstalações preservam inclusive permissões escolhidas pelo administrador.
    if [ -e "$media" ] || [ -L "$media" ]; then
        [ -d "$media" ] && [ ! -L "$media" ]
        return
    fi
    command -v setfacl >/dev/null 2>&1 || return 1

    # A ACL padrão é necessária: só 0777 na raiz deixaria subpastas novas em
    # 0755 sob umask 022. Todos podem atualizar este acervo público; nenhum dado
    # pessoal pertence aqui. Prepare dentro de uma pasta privada e publique sem
    # substituir um destino que apareceu durante a instalação.
    staging=$(mktemp -d "$base/.acervo-install.XXXXXXXXXX") || return 1
    if mkdir -m 0700 -- "$staging/acervo" \
        && setfacl -m 'u::rwx,g::rwx,o::rwx,d:u::rwx,d:g::rwx,d:o::rwx' -- "$staging/acervo" \
        && mv -T -n -- "$staging/acervo" "$media"; then
        rmdir -- "$staging/acervo" 2>/dev/null || true
        rmdir -- "$staging" 2>/dev/null || true
        [ -d "$media" ] && [ ! -L "$media" ]
        return
    fi
    # Só remove diretórios vazios criados por esta execução, nunca um acervo.
    rmdir -- "$staging/acervo" 2>/dev/null || true
    rmdir -- "$staging" 2>/dev/null || true
    return 1
}

if ! louvorja_provision_shared_collection; then
    echo "LouvorJA: não foi possível preparar /var/lib/louvorja-violin/acervo; pastas existentes foram preservadas. Configure o acervo ao abrir o aplicativo." >&2
fi

# BEGIN electron-builder default after-install
# Preserva alternativas, sandbox, MIME e AppArmor do template instalado.
# O teste linuxPackageStorage confere este trecho contra app-builder-lib.
#!/bin/bash

if type update-alternatives >/dev/null 2>&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Install apparmor profile. (Ubuntu 24+)
# First check if the version of AppArmor running on the device supports our profile.
# This is in order to keep backwards compatibility with Ubuntu 22.04 which does not support abi/4.0.
# In that case, we just skip installing the profile since the app runs fine without it on 22.04.
#
# Those apparmor_parser flags are akin to performing a dry run of loading a profile.
# https://wiki.debian.org/AppArmor/HowToUse#Dumping_profiles
#
# Unfortunately, at the moment AppArmor doesn't have a good story for backwards compatibility.
# https://askubuntu.com/questions/1517272/writing-a-backwards-compatible-apparmor-profile
if apparmor_status --enabled > /dev/null 2>&1; then
  APPARMOR_PROFILE_SOURCE='/opt/${sanitizedProductName}/resources/apparmor-profile'
  APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"

    # Updating the current AppArmor profile is not possible and probably not meaningful in a chroot'ed environment.
    # Use cases are for example environments where images for clients are maintained.
    # There, AppArmor might correctly be installed, but live updating makes no sense.
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      # Extra flags taken from dh_apparmor:
      # > By using '-W -T' we ensure that any abstraction updates are also pulled in.
      # https://wiki.debian.org/AppArmor/Contribute/FirstTimeProfileImport
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
    fi
  else
    echo "Skipping the installation of the AppArmor profile as this version of AppArmor does not seem to support the bundled profile"
  fi
fi
