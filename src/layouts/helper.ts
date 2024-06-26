import { RouterLink } from 'vue-router'

export function handleMenuOptions(rowMenu: any[]): any {
  return rowMenu.map((i) => {
    return {
      label: i.path
        ? () =>
            h(
              RouterLink,
              {
                to: {
                  path: i.path,
                },
              },
              { default: () => i.label },
            )
        : i.label,
      key: i.label,
      children: i.children && handleMenuOptions(i.children),
    }
  })
}
