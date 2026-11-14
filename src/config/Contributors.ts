import { ICONS } from "@/config/Icons";

export interface RoleContribuitor {
  name: RoleContribuitorEnum;
  icon: string;
  color: string;
}

enum RoleContribuitorEnum {
  web = "Web",
  desktop = "Violin Desktop",
  delphi = "Delphi",
  api = "API",
}

const ROLE_CONTRIBUTOR: Record<RoleContribuitorEnum, RoleContribuitor> = {
  [RoleContribuitorEnum.web]: {
    name: RoleContribuitorEnum.web,
    icon: ICONS.PROJETOS.WEB,
    color: "#1673c8",
  },
  [RoleContribuitorEnum.desktop]: {
    name: RoleContribuitorEnum.desktop,
    icon: ICONS.PROJETOS.DESKTOP,
    color: "#0fb0d3",
  },
  [RoleContribuitorEnum.delphi]: {
    name: RoleContribuitorEnum.delphi,
    icon: ICONS.PROJETOS.DELPHI,
    color: "#e53935",
  },
  [RoleContribuitorEnum.api]: {
    name: RoleContribuitorEnum.api,
    icon: ICONS.PROJETOS.API,
    color: "#43a047",
  },
};

export interface Contributors {
  name: string;
  description?: RoleContribuitor[] | string;
  image?: string;

  email?: string;
  website?: string;
  website2?: string;
  github?: string;

  x?: string;
  linkedin?: string;
  facebook?: string;
  instagram?: string;
  whatsapp?: string;
  telegram?: string;
}

interface ContributorsCategory {
  name: string;
  contributors: Contributors[];
}

export const CONTRIBUTORS: ContributorsCategory[] = [
  {
    name: "Mantenedores",
    contributors: [
      {
        name: "Diego Menezes",
        description: [
          ROLE_CONTRIBUTOR[RoleContribuitorEnum.web],
          ROLE_CONTRIBUTOR[RoleContribuitorEnum.desktop],
        ],
        website: "https://79team.com",
        github: "diego-menezes",
        linkedin: "menezes-diego",
      },
      {
        name: "Juan Aleixo",
        description: [
          ROLE_CONTRIBUTOR[RoleContribuitorEnum.web],
          ROLE_CONTRIBUTOR[RoleContribuitorEnum.desktop],
          ROLE_CONTRIBUTOR[RoleContribuitorEnum.api],
        ],
        github: "juanaleixo",
        linkedin: "juanaleixo",
      },
      {
        name: "Mayco W. G. Rolbuche",
        description: [
          ROLE_CONTRIBUTOR[RoleContribuitorEnum.web],
          ROLE_CONTRIBUTOR[RoleContribuitorEnum.delphi],
          ROLE_CONTRIBUTOR[RoleContribuitorEnum.api],
        ],
        email: "mayco_rolbuche@hotmail.com",
        github: "maycorolbuche",
        website: "https://maycorolbuche.com.br",
        website2: "https://www.hackerrank.com/profile/mayco_rolbuche",
        linkedin: "mayco-rolbuche",
        facebook: "maycorolbuche",
      },
    ],
  },

  {
    name: "Patrocinadores",
    contributors: [
      {
        name: "79 Team",
        description: "Tecnologia, inovação e desenvolvimento de software",
        email: "contato@79team.com",
        website: "https://79team.com",
        whatsapp: "5579933001017",
      },
      {
        name: "Afino",
        description: "Hub financeiro inteligente",
        website: "https://afino.com.br",
      },
    ],
  },

  {
    name: "Desenvolvedores",
    contributors: [
      {
        name: "Allan Anjos",
        description: [ROLE_CONTRIBUTOR[RoleContribuitorEnum.web]],
        website: "https://allananjos.dev.br",
        github: "anjosdevpython",
        linkedin: "allanfelipe-ti",
        whatsapp: "5541988875184",
      },
      {
        name: "Elias Matheus Oliveira",
        description: [ROLE_CONTRIBUTOR[RoleContribuitorEnum.desktop]],
        email: "eliasmatheus@hotmail.com",
        github: "eliasmatheus",
        linkedin: "eliasmatheus",
      },
      {
        name: "Henry Ávila",
        description: [ROLE_CONTRIBUTOR[RoleContribuitorEnum.delphi]],
        github: "henryavila",
        website: "https://henryavila.com",
      },
      {
        name: "Marcelo Araújo",
        description: [
          ROLE_CONTRIBUTOR[RoleContribuitorEnum.web],
          ROLE_CONTRIBUTOR[RoleContribuitorEnum.desktop],
        ],
        github: "marceloaraujo7-dev",
      },
      {
        name: "Paulo Vitor",
        description: [ROLE_CONTRIBUTOR[RoleContribuitorEnum.web]],
        email: "paulovitor.ssantos@outlook.com",
        github: "paulo-ssantos",
        linkedin: "paulo-2048",
      },
      {
        name: "Rafael Dias Zendron",
        description: [
          ROLE_CONTRIBUTOR[RoleContribuitorEnum.web],
          ROLE_CONTRIBUTOR[RoleContribuitorEnum.api],
        ],
        email: "rafael.zendron22@gmail.com",
        website: "https://portfoliodev-blush-pi.vercel.app",
        github: "rafaumeu",
        linkedin: "rafael-dias-zendron-528290132",
        x: "zendron22",
      },
      {
        name: "Savio Gabriel Santos",
        description: [
          ROLE_CONTRIBUTOR[RoleContribuitorEnum.web],
          ROLE_CONTRIBUTOR[RoleContribuitorEnum.delphi],
        ],
        email: "sg.ferreirasantos@gmail.com",
        website: "https://savio.dev.br/?id=1",
        github: "santos-savio",
        linkedin: "saviojob",
        whatsapp: "5535991975984",
      },
      {
        name: "Tiago Lima",
        description: [ROLE_CONTRIBUTOR[RoleContribuitorEnum.web]],
        email: "tiagolimadbvs7@gmail.com",
        website: "https://tiagolimadev.netlify.app/",
        github: "tiagoadv7",
        linkedin: "tiago-lima-4a90b4118",
        instagram: "tiagolimadbvs7",
        facebook: "tiago.nevesdelima",
        whatsapp: "5548988747793",
      },
      {
        name: "Victor Hugo Ventura Rodrigues",
        description: [
          ROLE_CONTRIBUTOR[RoleContribuitorEnum.web],
          ROLE_CONTRIBUTOR[RoleContribuitorEnum.delphi],
        ],
        email: "victor_hugo_ventura@hotmail.com",
        github: "corugo",
        facebook: "victor.hugo.ventura",
      },
    ],
  },

  {
    name: "Assets / UI",
    contributors: [
      {
        name: "Blog Daniel Gonçalves",
        description: "Áudio Escola Sabatina",
        website: "http://daniellocutor.com.br",
      },
      {
        name: "Elomar",
        description: "Remasterização e UI",
        github: "ElomarXA",
      },
    ],
  },

  {
    name: "Outros Colaboradores",
    contributors: [
      {
        name: "Alexandre Oliveira Melo",
        email: "flanquista51bis@hotmail.com",
        facebook: "alexandre.oliveiradossantos.54",
      },
      {
        name: "Augusto Resende",
        email: "augusto.resende@outlook.com",
        github: "augustresende",
        facebook: "AugustoResendePublico",
      },
      {
        name: "Caique Marcel",
        image:
          "https://gravatar.com/avatar/74bbcd134fe4d42b88c44535bd8cd92a51ca773d37d3c392dbf510071f2d2f84?s=144&d=404",
        email: "caiquemarceldbv@gmail.com",
      },
      {
        name: "Carlos Eduardo",
        email: "carlos.lol.lol.lol@gmail.com",
        facebook: "carlos.lol.lol.lol",
      },
      {
        name: "Edvaldo Cordeiro",
        email: "edvaldocostacordeiro@hotmail.com",
        facebook: "edvaldocostacordeiro",
      },
      {
        name: "Elcio Silva",
        email: "elciosilva.dbv@gmail.com",
        facebook: "elcio.silva.1422",
      },
      {
        name: "Eleandro Borel",
        facebook: "lele.kmi",
      },
      {
        name: "Gabriel Dutra Apolinário",
        email: "gabrieldutrqv@hotmail.com",
        facebook: "G2brielD2tra1",
      },
      {
        name: "Ido Rodrigues",
        email: "idorodrigues@hotmail.com",
        facebook: "ido.rodrigues",
      },
      {
        name: "Natanael Rodrigues",
        email: "natorso@hotmail.com",
        facebook: "natanael.srodrigues",
      },
      {
        name: "Neemias Lima",
        email: "neemiasml@gmail.com",
        website: "https://redeadventista.com/",
        facebook: "neemias.iasdc",
      },
      {
        name: "Rogerio Figueira",
        email: "roger.figueira31@gmail.com",
        facebook: "roger.figueira.14",
      },
    ],
  },
];
